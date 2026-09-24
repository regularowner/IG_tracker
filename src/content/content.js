// Content script injected into instagram.com

function showToast(message, isError = false) {
    let t = document.getElementById('insta-tracker-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'insta-tracker-toast';
        t.style.position = 'fixed';
        t.style.bottom = '20px';
        t.style.right = '20px';
        t.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
        t.style.color = '#ffffff';
        t.style.padding = '12px 18px';
        t.style.borderRadius = '10px';
        t.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        t.style.fontSize = '13px';
        t.style.fontWeight = '500';
        t.style.zIndex = '999999';
        t.style.backdropFilter = 'blur(10px)';
        t.style.border = '1px solid rgba(255,255,255,0.15)';
        t.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
        t.style.transition = 'all 0.3s ease';
        t.style.pointerEvents = 'none';
        document.body.appendChild(t);
    }
    t.style.borderColor = isError ? 'rgba(255, 75, 43, 0.6)' : 'rgba(0, 210, 255, 0.4)';
    t.innerText = message;
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
    
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
    }, 4500);
}

function detectCurrentUsername() {
    const parts = window.location.pathname.split('/').filter(p => p && p !== 'explore' && p !== 'reels' && p !== 'direct' && p !== 'stories' && p !== 'p');
    if (parts.length > 0) return parts[0];
    const match = document.cookie.match(/ds_user_id=([^;]+)/);
    if (match) return match[1];
    return null;
}

const getCSRFToken = () => {
    const match = document.cookie.match(/csrftoken=([^;]+)/);
    return match ? match[1] : '';
};
const appId = "936619743392459";

// Kullanıcı ID'si tespiti
async function resolveUserId(username) {
    let userId = null;
    const html = document.documentElement.innerHTML;
    
    let match = html.match(/"profilePage_([0-9]+)"/);
    if (!match) match = html.match(/"user_id":"([0-9]+)"/);
    if (!match) match = html.match(/"target_id":"([0-9]+)"/);
    if (match) userId = match[1];

    if (!userId) {
        try {
            const csrfToken = getCSRFToken();
            const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
                headers: { 
                    'x-ig-app-id': appId, 
                    'x-csrftoken': csrfToken,
                    'x-requested-with': 'XMLHttpRequest'
                }
            });
            if (res.ok) {
                const data = await res.json();
                userId = data?.data?.user?.id;
            }
        } catch(e) {
            console.error("[InstaTracker] UserID çözme hatası:", e);
        }
    }
    return userId;
}

// API ile Takipten Çıkma (Unfollow)
async function unfollowSingleUser(userId, username) {
    const csrfToken = getCSRFToken();
    let targetId = userId;
    
    if (!targetId && username) {
        targetId = await resolveUserId(username);
    }
    
    if (!targetId) {
        return { success: false, error: "id_not_found" };
    }

    try {
        const res = await fetch(`https://www.instagram.com/api/v1/friendships/destroy/${targetId}/`, {
            method: 'POST',
            headers: {
                'x-csrftoken': csrfToken,
                'x-ig-app-id': appId,
                'x-requested-with': 'XMLHttpRequest',
                'content-type': 'application/x-www-form-urlencoded'
            }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') {
                return { success: true };
            }
        } else if (res.status === 429) {
            return { success: false, error: "rate_limited" };
        }
        return { success: false, status: res.status };
    } catch(err) {
        console.error("Unfollow error:", err);
        return { success: false, error: err.message };
    }
}

// Toplu Güvenli Takipten Çıkma Asistanı (İnsansı gecikmeli)
async function batchUnfollowUsers(usersList, sourceAccount) {
    if (window.isBatchUnfollowing) return { success: false, error: "already_running" };
    window.isBatchUnfollowing = true;

    showToast(`⚡ ${usersList.length} kişi için güvenli takipten çıkma başladı...`);
    let countSuccess = 0;

    for (let i = 0; i < usersList.length; i++) {
        const user = usersList[i];
        
        chrome.runtime.sendMessage({
            action: "batchUnfollowProgress",
            current: i + 1,
            total: usersList.length,
            username: user.username
        }).catch(() => {});

        showToast(`(${i + 1}/${usersList.length}) @${user.username} takipten çıkılıyor...`);

        const res = await unfollowSingleUser(user.id, user.username);
        if (res.success) {
            countSuccess++;
            // Yerel depodan sil
            if (sourceAccount) {
                chrome.storage.local.get([`${sourceAccount}_notFollowingBack`, `${sourceAccount}_followingData`], (data) => {
                    let nfb = data[`${sourceAccount}_notFollowingBack`] || [];
                    let following = data[`${sourceAccount}_followingData`] || [];
                    nfb = nfb.filter(u => u.username.toLowerCase() !== user.username.toLowerCase());
                    following = following.filter(u => u.username.toLowerCase() !== user.username.toLowerCase());
                    chrome.storage.local.set({
                        [`${sourceAccount}_notFollowingBack`]: nfb,
                        [`${sourceAccount}_followingData`]: following
                    });
                });
            }
        } else if (res.error === "rate_limited") {
            showToast("Instagram limit uyguladı, işlem güvenlik amacıyla durduruldu.", true);
            break;
        }

        // Güvenlik Gecikmesi: 4.5 - 7.5 saniye rastgele bekleme
        if (i < usersList.length - 1) {
            const waitTime = Math.floor(Math.random() * 3000) + 4500;
            await new Promise(r => setTimeout(r, waitTime));
        }
    }

    window.isBatchUnfollowing = false;
    showToast(`✅ Tamamlandı: ${countSuccess} kişi başarıyla takipten çıkıldı.`);
    chrome.runtime.sendMessage({
        action: "batchUnfollowComplete",
        count: countSuccess
    }).catch(() => {});

    return { success: true, count: countSuccess };
}

// API ile Takipçi/Takip Edilen Listesi Çekme
async function scrapeListAPI(type, isSilent = false, forceUsername = null) {
    const username = forceUsername || detectCurrentUsername();
    
    if (!username) {
        if (!isSilent) showToast("Lütfen bir Instagram profiline gidin.", true);
        return { success: false, error: "no_profile" };
    }

    const csrfToken = getCSRFToken();
    const userId = await resolveUserId(username);

    if (!userId) {
        if (!isSilent) showToast("Profil ID'si alınamadı.", true);
        return { success: false, error: "user_id_not_found" };
    }

    const endpoint = type === 'followers' ? 'followers' : 'following';
    let allUsers = [];
    let maxId = '';
    let hasNextPage = true;

    while (hasNextPage) {
        try {
            let url = `https://www.instagram.com/api/v1/friendships/${userId}/${endpoint}/?count=100`;
            if (maxId) url += `&max_id=${maxId}`;

            const res = await fetch(url, {
                headers: {
                    'x-csrftoken': csrfToken,
                    'x-ig-app-id': appId,
                    'x-requested-with': 'XMLHttpRequest' 
                }
            });

            if (!res.ok) {
                if (res.status === 429) {
                    if (!isSilent) showToast("İstek limiti, 8 sn bekleniyor...", true);
                    await new Promise(r => setTimeout(r, 8000));
                    continue; 
                }
                throw new Error(`API Hatası: ${res.status}`);
            }

            const data = await res.json();
            const list = data.users || [];
            
            for (let u of list) {
                allUsers.push({
                    id: String(u.pk || u.id || ''),
                    username: u.username,
                    displayName: u.full_name || u.username,
                    profilePicUrl: u.profile_pic_url || '',
                    url: `https://instagram.com/${u.username}`,
                    isPrivate: !!u.is_private,
                    isVerified: !!u.is_verified
                });
            }

            if (!isSilent) {
                chrome.runtime.sendMessage({
                    action: "scrapeProgress",
                    type: type,
                    count: allUsers.length
                }).catch(() => {});
                showToast(`⚡ ${type === 'followers' ? 'Takipçiler' : 'Takip Edilenler'}: ${allUsers.length} kişi...`);
            }

            if (data.next_max_id) {
                maxId = data.next_max_id;
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 500) + 500));
            } else {
                hasNextPage = false; 
            }

        } catch (err) {
            console.error("[InstaTracker] Scraping durdu:", err);
            break;
        }
    }

    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: "saveData",
            payload: {
                sourceAccount: username,
                type: type,
                data: allUsers
            }
        }, (response) => {
            resolve({ success: true, count: allUsers.length, users: allUsers });
        });
    });
}

// Tam Senkronizasyon
async function executeFullSync(username, isSilent = false) {
    if (window.isSyncingInProgress) return;
    window.isSyncingInProgress = true;

    if (!isSilent) showToast(`🚀 @${username} için analiz başlatılıyor...`);

    try {
        if (!isSilent) chrome.runtime.sendMessage({ action: "analysisStep", step: "followers", text: "👥 Takipçiler çekiliyor..." }).catch(()=>{});
        await scrapeListAPI('followers', isSilent, username);
        
        await new Promise(r => setTimeout(r, 1500));

        if (!isSilent) chrome.runtime.sendMessage({ action: "analysisStep", step: "following", text: "➡️ Takip edilenler çekiliyor..." }).catch(()=>{});
        await scrapeListAPI('following', isSilent, username);

        await new Promise(r => setTimeout(r, 1000));

        if (!isSilent) chrome.runtime.sendMessage({ action: "analysisStep", step: "diff", text: "⚡ Değişiklikler hesaplanıyor..." }).catch(()=>{});

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
                action: "processDiff", 
                sourceAccount: username,
                isSilent: isSilent
            }, (diffRes) => {
                window.isSyncingInProgress = false;
                if (!isSilent) {
                    showToast(`✅ @${username} analizi tamamlandı!`);
                    chrome.runtime.sendMessage({ action: "analysisComplete", data: diffRes }).catch(()=>{});
                }
                resolve(diffRes);
            });
        });
    } catch (e) {
        window.isSyncingInProgress = false;
        console.error("Sync error:", e);
        if (!isSilent) showToast("Analiz sırasında hata oluştu.", true);
        return { success: false, error: e };
    }
}

// Mesaj dinleyici
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startFullAnalysis") {
        executeFullSync(request.username, false).then(result => sendResponse({ success: true, result }));
        return true;
    }

    if (request.action === "startSilentSync") {
        executeFullSync(request.username, true).then(result => sendResponse({ success: true, result }));
        return true;
    }

    if (request.action === "unfollowUser") {
        unfollowSingleUser(request.userId, request.username).then(result => {
            sendResponse(result);
        });
        return true;
    }

    if (request.action === "batchUnfollow") {
        batchUnfollowUsers(request.users, request.sourceAccount).then(result => {
            sendResponse(result);
        });
        return true;
    }
});

// Sayfadaki "Geri Takip Etmiyor" etiketini yerleştirme
let lastCheckedProfile = '';
setInterval(() => {
    const parts = window.location.pathname.split('/').filter(p => p);
    if (parts.length === 1) {
        const username = parts[0];
        const ignoredPaths = ['explore', 'reels', 'direct', 'stories', 'p'];
        if (ignoredPaths.includes(username)) return;

        if (username !== lastCheckedProfile) {
            lastCheckedProfile = username;

            setTimeout(() => {
                chrome.storage.local.get(null, (allData) => {
                    const nfbKeys = Object.keys(allData).filter(k => k.endsWith('_notFollowingBack'));
                    let doesntFollowAccounts = [];

                    for (let key of nfbKeys) {
                        const accountName = key.replace('_notFollowingBack', '');
                        const nfbList = allData[key] || [];
                        if (nfbList.some(u => u.username.toLowerCase() === username.toLowerCase())) {
                            doesntFollowAccounts.push(accountName);
                        }
                    }

                    let badge = document.getElementById('insta-tracker-badge');
                    if (doesntFollowAccounts.length > 0) {
                        const headers = document.querySelectorAll('header');
                        if (headers.length > 0) {
                            const header = headers[0];
                            if (!badge) {
                                badge = document.createElement('span'); 
                                badge.id = 'insta-tracker-badge';
                                badge.style.backgroundColor = '#ff4d4f';
                                badge.style.color = 'white';
                                badge.style.padding = '4px 10px';
                                badge.style.borderRadius = '20px';
                                badge.style.fontSize = '12px';
                                badge.style.fontWeight = '600';
                                badge.style.marginLeft = '12px';
                                badge.style.display = 'inline-block';
                                badge.style.verticalAlign = 'middle';
                                badge.style.boxShadow = '0 4px 12px rgba(255, 77, 79, 0.4)';
                                
                                const h2Elements = header.querySelectorAll('h2');
                                let targetFound = false;
                                for (let h2 of h2Elements) {
                                    if (h2.innerText.toLowerCase() === username.toLowerCase() || h2.innerText.includes(username)) {
                                        h2.parentElement.appendChild(badge);
                                        targetFound = true;
                                        break;
                                    }
                                }
                                if (!targetFound) {
                                    const firstSection = header.querySelector('section');
                                    if (firstSection && firstSection.firstElementChild) {
                                       firstSection.firstElementChild.appendChild(badge);
                                    } else {
                                        header.appendChild(badge);
                                    }
                                }
                            }
                            let accountsText = doesntFollowAccounts.length > 1 ? doesntFollowAccounts.join(', ') : doesntFollowAccounts[0];
                            badge.innerText = `⚠️ @${accountsText} sizi geri takip etmiyor`;
                        }
                    } else {
                        if (badge) badge.remove();
                    }
                });
            }, 1800);
        }
    } else {
        lastCheckedProfile = '';
    }
}, 2000);
