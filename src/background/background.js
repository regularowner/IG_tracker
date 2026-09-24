// Background Service Worker for InstaTracker (Tam Hesap İzolasyonlu)

const ALARM_NAME = "insta_tracker_auto_sync";

const normalizeAcc = (acc) => String(acc || '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');

chrome.runtime.onInstalled.addListener(() => {
  console.log("InstaTracker Multi-Account installed.");
  setupAlarm(30);
});

function setupAlarm(intervalInMinutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    if (intervalInMinutes && intervalInMinutes > 0) {
      chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: intervalInMinutes
      });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    triggerBackgroundSync();
  }
});

function triggerBackgroundSync() {
  chrome.storage.local.get(["autoSyncEnabled"], (settings) => {
    const isEnabled = settings.autoSyncEnabled !== false;
    if (!isEnabled) return;

    chrome.tabs.query({ url: "*://*.instagram.com/*" }, (tabs) => {
      if (tabs.length === 0) return;
      const activeTab = tabs[0];
      
      chrome.storage.local.get(null, (allData) => {
        const followerKeys = Object.keys(allData).filter(k => k.endsWith('_followerData'));
        const accountsToSync = followerKeys.map(k => k.replace('_followerData', ''));

        if (accountsToSync.length > 0) {
          accountsToSync.forEach((account, idx) => {
            setTimeout(() => {
              chrome.tabs.sendMessage(activeTab.id, { 
                action: "startSilentSync", 
                username: account 
              }).catch(() => {});
            }, idx * 45000);
          });
        }
      });
    });
  });
}

// Mesaj Dinleyicisi
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateAlarmInterval") {
    const minutes = parseInt(request.intervalMinutes, 10);
    if (request.enabled) {
      setupAlarm(minutes || 30);
    } else {
      chrome.alarms.clear(ALARM_NAME);
    }
    chrome.storage.local.set({ 
      autoSyncEnabled: !!request.enabled,
      autoSyncInterval: minutes || 30 
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "saveData") {
    const rawAccount = request.payload.sourceAccount;
    const account = normalizeAcc(rawAccount);
    const { type, data } = request.payload;
    if (!account) return;

    if (type === "followers") {
      chrome.storage.local.set({ [`${account}_currentFollowers`]: data }, () => {
        sendResponse({ success: true, message: "Followers saved." });
      });
    } else if (type === "following") {
      chrome.storage.local.set({ [`${account}_currentFollowing`]: data }, () => {
        sendResponse({ success: true, message: "Following saved." });
      });
    }
    return true;
  }

  if (request.action === "processDiff") {
    const account = normalizeAcc(request.sourceAccount);
    const isSilent = !!request.isSilent;
    if (!account) return;
    
    processAndStoreDiff(account, isSilent, sendResponse);
    return true;
  }
});

function sendNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "src/icons/icon128.png",
    title: title,
    message: message,
    priority: 2
  });
}

// Farkları Hesaplama, Hesap Çakışma Koruması ve Geçmiş Kaydı
function processAndStoreDiff(account, isSilent, sendResponse) {
  const normAccount = normalizeAcc(account);
  const kCF = `${normAccount}_currentFollowers`;
  const kCFl = `${normAccount}_currentFollowing`;
  const kF = `${normAccount}_followerData`;
  const kFl = `${normAccount}_followingData`;
  const kH = `${normAccount}_history`;
  const kLFList = `${normAccount}_cumulativeLostFollowers`;

  chrome.storage.local.get([kCF, kCFl, kF, kFl, kH, kLFList], (result) => {
    const currentFollowers = result[kCF] || [];
    const currentFollowing = result[kCFl] || [];
    const oldFollowers = result[kF] || [];
    const oldFollowing = result[kFl] || [];
    const history = result[kH] || [];
    let cumulativeLost = result[kLFList] || [];

    // GÜVENLİK KORUMASI: Eğer yeni çekilen veri boş ise ama eski takipçiler varsa,
    // bu bir API çekim hatasıdır; eski takipçileri "takipten çıkmış" sanıp çakışma yaratma!
    if (currentFollowers.length === 0 && oldFollowers.length > 0) {
      console.warn(`[InstaTracker] @${normAccount} için çekilen takipçi verisi boş geldi. Eski veriler korundu.`);
      if (typeof sendResponse === 'function') {
        sendResponse({ success: false, error: "empty_current_data_guarded" });
      }
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString();

    const isSameUser = (u1, u2) => {
      if (u1 && u2 && u1.id && u2.id) return String(u1.id) === String(u2.id);
      if (u1 && u2 && u1.username && u2.username) {
        return u1.username.toLowerCase() === u2.username.toLowerCase();
      }
      return false;
    };

    // 1. Geri takip etmeyenler
    const notFollowingBack = currentFollowing.filter(
      user => !currentFollowers.some(f => isSameUser(f, user))
    );
    
    // 2. Bu analizdeki YENİ takipten çıkanlar (Sadece eski veri varsa ve yeni veri geçerliyse)
    let newLostInThisRun = [];
    if (oldFollowers.length > 0 && currentFollowers.length > 0) {
      newLostInThisRun = oldFollowers.filter(
        oldUser => !currentFollowers.some(currentUser => isSameUser(currentUser, oldUser))
      );
    }

    // 3. Bu analizdeki YENİ takipçiler
    let newFollowersInThisRun = [];
    if (oldFollowers.length > 0 && currentFollowers.length > 0) {
      newFollowersInThisRun = currentFollowers.filter(
        currentUser => !oldFollowers.some(oldUser => isSameUser(oldUser, currentUser))
      );
    }

    // 4. Kümülatif takipten çıkanlar listesini güncelle (Yalnızca bu hesaba ait)
    newLostInThisRun.forEach(lostUser => {
      const alreadyInList = cumulativeLost.some(u => isSameUser(u, lostUser));
      if (!alreadyInList) {
        cumulativeLost.unshift({
          ...lostUser,
          lostDate: dateStr
        });
      }
    });

    // Tekrar takip edenleri listeden çıkar
    cumulativeLost = cumulativeLost.filter(
      lostUser => !currentFollowers.some(currentUser => isSameUser(currentUser, lostUser))
    );

    // 5. Masaüstü Bildirimi Gönderme
    if (newLostInThisRun.length > 0) {
      const names = newLostInThisRun.map(u => `@${u.username}`).slice(0, 3).join(', ');
      const moreText = newLostInThisRun.length > 3 ? ` ve ${newLostInThisRun.length - 3} kişi daha` : '';
      sendNotification(
        `⚠️ Takipten Çıkan Var! (@${normAccount})`, 
        `${names}${moreText} sizi takipten çıktı.`
      );
    }

    if (newFollowersInThisRun.length > 0) {
      const names = newFollowersInThisRun.map(u => `@${u.username}`).slice(0, 3).join(', ');
      const moreText = newFollowersInThisRun.length > 3 ? ` ve ${newFollowersInThisRun.length - 3} kişi daha` : '';
      sendNotification(
        `🚀 Yeni Takipçi! (@${normAccount})`, 
        `${names}${moreText} sizi takip etmeye başladı.`
      );
    }

    // 6. Analiz geçmişi kaydı
    const newHistoryEntry = {
      date: dateStr,
      lostFollowers: newLostInThisRun,
      newFollowers: newFollowersInThisRun,
      stats: {
        followersCount: currentFollowers.length,
        followingCount: currentFollowing.length,
        notFollowingBackCount: notFollowingBack.length,
        totalLostCount: cumulativeLost.length
      },
      trigger: isSilent ? 'auto' : 'manual'
    };

    history.push(newHistoryEntry);

    // 7. Sadece bu hesaba ait anahtarları depola
    chrome.storage.local.set({
      [`${normAccount}_followerData`]: currentFollowers,
      [`${normAccount}_followingData`]: currentFollowing,
      [`${normAccount}_notFollowingBack`]: notFollowingBack,
      [`${normAccount}_cumulativeLostFollowers`]: cumulativeLost,
      [`${normAccount}_history`]: history,
      [`${normAccount}_lastAnalyzed`]: dateStr
    }, () => {
      if (typeof sendResponse === 'function') {
        sendResponse({ 
          success: true, 
          message: "Diff processed successfully", 
          data: newHistoryEntry,
          cumulativeLost: cumulativeLost
        });
      }
    });
  });
}
