// Background Service Worker for InstaTracker

const ALARM_NAME = "insta_tracker_auto_sync";

chrome.runtime.onInstalled.addListener(() => {
  console.log("InstaTracker Multi-Account installed.");
  setupAlarm(30); // Varsayılan 30 dakikada bir kontrol
});

// Alarm Yapılandırması
function setupAlarm(intervalInMinutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    if (intervalInMinutes && intervalInMinutes > 0) {
      chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: intervalInMinutes
      });
      console.log(`[InstaTracker] Otomatik alarm kuruldu: her ${intervalInMinutes} dakikada bir.`);
    }
  });
}

// Alarm Tetiklenince Çalışacak Mantık
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    triggerBackgroundSync();
  }
});

// Arka Planda Otomatik Senkronizasyon Tetikleyici
function triggerBackgroundSync() {
  chrome.storage.local.get(["autoSyncEnabled", "monitoredAccounts"], (settings) => {
    // Varsayılan olarak açık kabul edelim
    const isEnabled = settings.autoSyncEnabled !== false;
    if (!isEnabled) {
      console.log("[InstaTracker] Otomatik takip kapalı.");
      return;
    }

    // Açık olan Instagram sekmelerini bul
    chrome.tabs.query({ url: "*://*.instagram.com/*" }, (tabs) => {
      if (tabs.length === 0) {
        console.log("[InstaTracker] Açık Instagram sekmesi bulunamadı, bekleniyor.");
        return;
      }

      // İlk Instagram sekmesini kullanarak işlemi yap
      const activeTab = tabs[0];
      
      // Kayıtlı izlenen hesapları al veya aktif hesabı tara
      chrome.storage.local.get(null, (allData) => {
        const followerKeys = Object.keys(allData).filter(k => k.endsWith('_followerData'));
        const accountsToSync = followerKeys.map(k => k.replace('_followerData', ''));

        if (accountsToSync.length === 0) {
          // Henüz kayıtlı hesap yoksa o an açık olan profili tara
          chrome.tabs.sendMessage(activeTab.id, { action: "autoSyncCurrentProfile" }).catch(() => {});
        } else {
          // Kayıtlı hesapları sırayla sessizce tara
          accountsToSync.forEach((account, idx) => {
            setTimeout(() => {
              chrome.tabs.sendMessage(activeTab.id, { 
                action: "startSilentSync", 
                username: account 
              }).catch(() => {});
            }, idx * 45000); // Hesaplar arası 45 sn dinlenme
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
    const { sourceAccount, type, data } = request.payload;
    if (!sourceAccount) return;

    if (type === "followers") {
      chrome.storage.local.set({ [`${sourceAccount}_currentFollowers`]: data }, () => {
        sendResponse({ success: true, message: "Followers saved." });
      });
    } else if (type === "following") {
      chrome.storage.local.set({ [`${sourceAccount}_currentFollowing`]: data }, () => {
        sendResponse({ success: true, message: "Following saved." });
      });
    }
    return true;
  }

  if (request.action === "processDiff") {
    const account = request.sourceAccount;
    const isSilent = !!request.isSilent;
    if (!account) return;
    
    processAndStoreDiff(account, isSilent, sendResponse);
    return true;
  }

  if (request.action === "triggerSyncNow") {
    triggerBackgroundSync();
    sendResponse({ success: true });
    return true;
  }
});

// Bildirim Gönderici
function sendNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "src/icons/icon128.png",
    title: title,
    message: message,
    priority: 2
  });
}

// Farkları Hesaplama, Geçmiş Kaydı ve Bildirim
function processAndStoreDiff(account, isSilent, sendResponse) {
  const kCF = `${account}_currentFollowers`;
  const kCFl = `${account}_currentFollowing`;
  const kF = `${account}_followerData`;
  const kFl = `${account}_followingData`;
  const kH = `${account}_history`;
  const kLFList = `${account}_cumulativeLostFollowers`;

  chrome.storage.local.get([kCF, kCFl, kF, kFl, kH, kLFList], (result) => {
    const currentFollowers = result[kCF] || [];
    const currentFollowing = result[kCFl] || [];
    const oldFollowers = result[kF] || [];
    const oldFollowing = result[kFl] || [];
    const history = result[kH] || [];
    let cumulativeLost = result[kLFList] || [];

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
    
    // 2. Bu analizdeki YENİ takipten çıkanlar
    let newLostInThisRun = [];
    if (oldFollowers.length > 0) {
      newLostInThisRun = oldFollowers.filter(
        oldUser => !currentFollowers.some(currentUser => isSameUser(currentUser, oldUser))
      );
    }

    // 3. Bu analizdeki YENİ takipçiler
    let newFollowersInThisRun = [];
    if (oldFollowers.length > 0) {
      newFollowersInThisRun = currentFollowers.filter(
        currentUser => !oldFollowers.some(oldUser => isSameUser(oldUser, currentUser))
      );
    }

    // 4. Kümülatif takipten çıkanlar listesini güncelle
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
        `⚠️ Takipten Çıkan Var! (@${account})`, 
        `${names}${moreText} sizi takipten çıktı.`
      );
    }

    if (newFollowersInThisRun.length > 0) {
      const names = newFollowersInThisRun.map(u => `@${u.username}`).slice(0, 3).join(', ');
      const moreText = newFollowersInThisRun.length > 3 ? ` ve ${newFollowersInThisRun.length - 3} kişi daha` : '';
      sendNotification(
        `🚀 Yeni Takipçi! (@${account})`, 
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

    // 7. Depola
    chrome.storage.local.set({
      [`${account}_followerData`]: currentFollowers,
      [`${account}_followingData`]: currentFollowing,
      [`${account}_notFollowingBack`]: notFollowingBack,
      [`${account}_cumulativeLostFollowers`]: cumulativeLost,
      [`${account}_history`]: history,
      [`${account}_lastAnalyzed`]: dateStr
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
