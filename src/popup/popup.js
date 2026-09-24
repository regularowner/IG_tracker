document.addEventListener('DOMContentLoaded', () => {
    
    // --- UI Elements ---
    const btnStartFullAnalysis = document.getElementById('start-full-analysis');
    const btnAnalyzeText = document.getElementById('btn-analyze-text');
    const btnClearData = document.getElementById('clear-data');
    const btnDetectTab = document.getElementById('btn-detect-tab');
    const statusText = document.getElementById('status-text');
    const progressBar = document.getElementById('progress-bar');
    const accountSelect = document.getElementById('account-select');
    const searchInput = document.getElementById('search-input');

    // İstatistik Sayı Alanları
    const statFollowers = document.getElementById('stat-followers');
    const statFollowing = document.getElementById('stat-following');
    const statNotFollowing = document.getElementById('stat-not-following');

    // Toplu Takipten Çıkma
    const btnBatch5 = document.getElementById('batch-unfollow-5');
    const btnBatch10 = document.getElementById('batch-unfollow-10');

    // Otomatik Takip UI
    const autoSyncToggle = document.getElementById('auto-sync-toggle');
    const autoIntervalSelect = document.getElementById('auto-interval-select');
    const autoStatusBadge = document.getElementById('auto-status-badge');
    const autoSettingsPanel = document.getElementById('auto-settings-panel');
    
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    const countNFB = document.getElementById('nfb-count');
    const tabCountNFB = document.getElementById('tab-nfb-count');
    const countLF = document.getElementById('lf-count');
    const tabCountLF = document.getElementById('tab-lf-count');
    const tabCountHistory = document.getElementById('tab-history-count');
    
    const listNFB = document.getElementById('list-nfb');
    const listLF = document.getElementById('list-lf');
    const listHistory = document.getElementById('list-history');

    let currentNfbData = [];
    let currentLostData = [];
    let currentHistoryData = [];
    let activeAccount = null;
    let activeFilter = 'all';
    let searchQuery = '';

    // --- Otomatik Takip Ayarlarını Yükle ---
    chrome.storage.local.get(["autoSyncEnabled", "autoSyncInterval"], (res) => {
        const isEnabled = res.autoSyncEnabled !== false;
        const interval = res.autoSyncInterval || 30;

        autoSyncToggle.checked = isEnabled;
        autoIntervalSelect.value = String(interval);
        updateAutoSyncStatusUI(isEnabled, interval);
    });

    function updateAutoSyncStatusUI(enabled, interval) {
        if (enabled) {
            autoStatusBadge.innerText = `🟢 Aktif (${interval} dk)`;
            autoStatusBadge.className = "auto-track-status active";
            autoSettingsPanel.style.opacity = "1";
            autoSettingsPanel.style.pointerEvents = "auto";
        } else {
            autoStatusBadge.innerText = `⚪ Kapalı`;
            autoStatusBadge.className = "auto-track-status disabled";
            autoSettingsPanel.style.opacity = "0.4";
            autoSettingsPanel.style.pointerEvents = "none";
        }
    }

    autoSyncToggle.addEventListener('change', () => {
        const enabled = autoSyncToggle.checked;
        const interval = parseInt(autoIntervalSelect.value, 10);
        updateAutoSyncStatusUI(enabled, interval);
        chrome.runtime.sendMessage({
            action: "updateAlarmInterval",
            enabled: enabled,
            intervalMinutes: interval
        });
    });

    autoIntervalSelect.addEventListener('change', () => {
        const enabled = autoSyncToggle.checked;
        const interval = parseInt(autoIntervalSelect.value, 10);
        updateAutoSyncStatusUI(enabled, interval);
        chrome.runtime.sendMessage({
            action: "updateAlarmInterval",
            enabled: enabled,
            intervalMinutes: interval
        });
    });

    const normalizeAcc = (acc) => String(acc || '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');

    // --- Çoklu Hesap Yönetimi (Account Switcher) ---
    function populateAccountDropdown(preferredAccount) {
        chrome.storage.local.get(null, (all) => {
            const keys = Object.keys(all).filter(k => k.endsWith('_followerData'));
            let accounts = Array.from(new Set(keys.map(k => normalizeAcc(k.replace('_followerData', ''))))).filter(Boolean);
            
            const cleanPref = normalizeAcc(preferredAccount);
            if (cleanPref && !accounts.includes(cleanPref)) {
                accounts.unshift(cleanPref);
            }

            accountSelect.innerHTML = '';
            
            if (accounts.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.innerText = 'Instagram Profilini Açın...';
                accountSelect.appendChild(opt);
                return;
            }

            accounts.forEach(acc => {
                const opt = document.createElement('option');
                opt.value = acc;
                opt.innerText = `@${acc}`;
                if (acc === (cleanPref || activeAccount)) {
                    opt.selected = true;
                    activeAccount = acc;
                }
                accountSelect.appendChild(opt);
            });

            if (activeAccount) {
                btnAnalyzeText.innerText = `@${activeAccount} Analizini Başlat`;
            }
        });
    }

    accountSelect.addEventListener('change', (e) => {
        const chosen = normalizeAcc(e.target.value);
        if (chosen) {
            activeAccount = chosen;
            btnAnalyzeText.innerText = `@${activeAccount} Analizini Başlat`;
            statusText.innerText = `Seçili Hesap: @${activeAccount}`;
            updateUI();
        }
    });

    // Aktif Sekmeyi Yeniden Algıla Butonu
    btnDetectTab.addEventListener('click', () => {
        detectActiveTabAccount(true);
    });

    function detectActiveTabAccount(notifyUser = false) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            let detected = null;
            if (tabs.length > 0 && tabs[0].url) {
                let url = tabs[0].url;
                if (url.includes("instagram.com")) {
                    try {
                        const urlObj = new URL(url);
                        const parts = urlObj.pathname.split('/').filter(p => p);
                        const ignoredPaths = ['explore', 'reels', 'direct', 'stories', 'p'];
                        if (parts.length > 0 && !ignoredPaths.includes(parts[0])) {
                            detected = parts[0];
                        }
                    } catch(e) {}
                }
            }
            
            if (detected) {
                activeAccount = normalizeAcc(detected);
                populateAccountDropdown(activeAccount);
                btnAnalyzeText.innerText = `@${activeAccount} Analizini Başlat`;
                statusText.innerText = `Aktif Sekme: @${activeAccount}`;
                statusText.style.color = "var(--success)";
                if (notifyUser) alert(`@${activeAccount} profili başarıyla seçildi.`);
                updateUI();
            } else {
                chrome.storage.local.get(null, (all) => {
                    const keys = Object.keys(all).filter(k => k.endsWith('_followerData'));
                    if (keys.length > 0) {
                        activeAccount = normalizeAcc(keys[0].replace('_followerData', ''));
                        populateAccountDropdown(activeAccount);
                        btnAnalyzeText.innerText = `@${activeAccount} Analizini Başlat`;
                        statusText.innerText = `Kayıtlı Profil: @${activeAccount}`;
                        updateUI();
                    } else {
                        populateAccountDropdown(null);
                        statusText.innerText = `Lütfen Instagram'da bir profil açın.`;
                        statusText.style.color = "var(--danger)";
                    }
                });
            }
        });
    }

    // İlk açılışta algıla
    detectActiveTabAccount(false);

    // Tab Geçişleri
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const target = document.getElementById(btn.dataset.target);
            if (target) {
                target.classList.add('active');
                target.classList.remove('fade-in');
                void target.offsetWidth;
                target.classList.add('fade-in');
            }
        });
    });

    // Filtre Düğmeleri
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            renderNfbList();
        });
    });

    // Arama Alanı
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderNfbList();
        renderLostList();
    });

    // Tekil Takipten Çıkma (Unfollow)
    function handleUnfollowClick(btn, user) {
        if (!confirm(`@${user.username} kişisini takipten çıkmak istediğinize emin misiniz?`)) return;

        btn.disabled = true;
        btn.className = "unfollow-btn loading";
        btn.innerText = "Çıkılıyor...";

        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            const activeTab = tabs[0];
            const sendMessageAction = (tabId) => {
                chrome.tabs.sendMessage(tabId, {
                    action: "unfollowUser",
                    userId: user.id,
                    username: user.username
                }, (response) => {
                    if (response && response.success) {
                        btn.className = "unfollow-btn done";
                        btn.innerText = "✓ Çıkarıldı";

                        if (activeAccount) {
                            currentNfbData = currentNfbData.filter(u => u.username.toLowerCase() !== user.username.toLowerCase());
                            chrome.storage.local.set({ [`${activeAccount}_notFollowingBack`]: currentNfbData });
                            countNFB.innerText = currentNfbData.length;
                            tabCountNFB.innerText = currentNfbData.length;
                            statNotFollowing.innerText = currentNfbData.length;
                        }

                        const card = btn.closest('.user-item');
                        if (card) {
                            setTimeout(() => {
                                card.style.transition = 'all 0.3s ease';
                                card.style.opacity = '0';
                                card.style.transform = 'scale(0.9)';
                                setTimeout(() => card.remove(), 300);
                            }, 800);
                        }
                    } else {
                        btn.disabled = false;
                        btn.className = "unfollow-btn";
                        btn.innerText = "Tekrar Dene";
                        alert("Takipten çıkılamadı. Instagram sekmenizi yenileyip tekrar deneyin.");
                    }
                });
            };

            if (activeTab && activeTab.url && activeTab.url.includes("instagram.com")) {
                sendMessageAction(activeTab.id);
            } else {
                chrome.tabs.query({url: "*://*.instagram.com/*"}, (igTabs) => {
                    if (igTabs.length > 0) {
                        sendMessageAction(igTabs[0].id);
                    } else {
                        btn.disabled = false;
                        btn.className = "unfollow-btn";
                        btn.innerText = "Takipten Çık";
                        alert("Lütfen açık bir Instagram sekmesi bulundurun.");
                    }
                });
            }
        });
    }

    // Kullanıcı Listesi Çizdirici
    function renderUserList(container, users, emptyMessage, isLostList = false) {
        container.innerHTML = '';
        if (!users || users.length === 0) {
            container.innerHTML = `<li class="empty-state">${emptyMessage}</li>`;
            return;
        }

        users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'user-item';
            
            const isPrivate = user.isPrivate;
            const isVerified = user.isVerified;
            
            let avatarHtml = '';
            if (user.profilePicUrl) {
                avatarHtml = `<img class="user-avatar-img" src="${user.profilePicUrl}" alt="${user.username}" onerror="this.outerHTML='<div class=\\'user-avatar\\'>${user.username.charAt(0).toUpperCase()}</div>'">`;
            } else {
                avatarHtml = `<div class="user-avatar ${isPrivate ? 'avatar-private' : ''}">${user.username.charAt(0).toUpperCase()}</div>`;
            }

            let extraDateTag = '';
            if (isLostList && user.lostDate) {
                const dateObj = new Date(user.lostDate);
                const dStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
                extraDateTag = `<span class="lost-date-tag">🔻 ${dStr}</span>`;
            }

            li.innerHTML = `
                <div class="avatar-container">
                    ${avatarHtml}
                </div>
                <div class="user-info">
                    <div class="username-row">
                        <a href="${user.url || `https://instagram.com/${user.username}`}" target="_blank" class="username" title="@${user.username}">${user.username}</a>
                        ${isVerified ? '<span class="verified-icon" title="Onaylı">✓</span>' : ''}
                        ${extraDateTag}
                    </div>
                    <div class="display-name">
                        <span class="name-text" title="${user.displayName || user.username}">${user.displayName || user.username}</span>
                        ${isPrivate ? '<span class="private-tag">🔒 Gizli</span>' : ''}
                    </div>
                </div>
                <div class="user-actions">
                    <button class="unfollow-btn" title="Bu kişiyi takipten çık">Takipten Çık</button>
                </div>
            `;

            const unfollowBtn = li.querySelector('.unfollow-btn');
            unfollowBtn.addEventListener('click', () => handleUnfollowClick(unfollowBtn, user));

            container.appendChild(li);
        });
    }

    function renderNfbList() {
        let filtered = currentNfbData;
        if (activeFilter === 'private') {
            filtered = filtered.filter(u => u.isPrivate);
        } else if (activeFilter === 'public') {
            filtered = filtered.filter(u => !u.isPrivate);
        }

        if (searchQuery) {
            filtered = filtered.filter(u => 
                u.username.toLowerCase().includes(searchQuery) || 
                (u.displayName && u.displayName.toLowerCase().includes(searchQuery))
            );
        }
        
        countNFB.innerText = filtered.length;
        tabCountNFB.innerText = currentNfbData.length;
        statNotFollowing.innerText = currentNfbData.length;
        renderUserList(listNFB, filtered, "Herkes sizi geri takip ediyor veya filtreye uygun sonuç yok! 🎉");
    }

    function renderLostList() {
        let filtered = currentLostData;
        if (searchQuery) {
            filtered = filtered.filter(u => 
                u.username.toLowerCase().includes(searchQuery) || 
                (u.displayName && u.displayName.toLowerCase().includes(searchQuery))
            );
        }
        countLF.innerText = filtered.length;
        tabCountLF.innerText = currentLostData.length;
        renderUserList(listLF, filtered, "Kayıtlı takipten çıkan kimse yok! 🥳", true);
    }

    // Detaylı Geçmiş Zaman Çizelgesi
    function renderHistoryList(container, history, emptyMessage) {
        container.innerHTML = '';
        if (!history || history.length === 0) {
            container.innerHTML = `<li class="empty-state">${emptyMessage}</li>`;
            return;
        }

        tabCountHistory.innerText = history.length;
        const sorted = [...history].reverse();

        sorted.forEach(entry => {
            const dateStr = new Date(entry.date).toLocaleString('tr-TR', { 
                day: '2-digit', month: 'short', year: 'numeric', 
                hour: '2-digit', minute:'2-digit' 
            });
            
            const isAuto = entry.trigger === 'auto';
            const triggerBadge = isAuto 
                ? `<span class="history-type-badge auto">🤖 Otomatik</span>` 
                : `<span class="history-type-badge manual">👤 Manuel</span>`;

            const li = document.createElement('li');
            li.className = 'history-item';
            
            let diffDetails = '';
            if (entry.lostFollowers && entry.lostFollowers.length > 0) {
                const lostNames = entry.lostFollowers.map(u => `<a href="https://instagram.com/${u.username}" target="_blank" class="h-user-link">@${u.username}</a>`).join(', ');
                diffDetails += `<div class="h-diff-row h-lost">🔻 Çıkanlar (${entry.lostFollowers.length}): ${lostNames}</div>`;
            }
            if (entry.newFollowers && entry.newFollowers.length > 0) {
                const newNames = entry.newFollowers.map(u => `<a href="https://instagram.com/${u.username}" target="_blank" class="h-user-link">@${u.username}</a>`).join(', ');
                diffDetails += `<div class="h-diff-row h-new">🚀 Yeni (${entry.newFollowers.length}): ${newNames}</div>`;
            }

            li.innerHTML = `
                <div class="history-header-row">
                    <div class="history-date">${dateStr}</div>
                    ${triggerBadge}
                </div>
                <div class="history-stats">
                    <span>Takipçi: <span class="hw">${entry.stats.followersCount}</span></span>
                    <span>Takip: <span class="hw">${entry.stats.followingCount}</span></span>
                    <span>Nankör: <span class="hw">${entry.stats.notFollowingBackCount}</span></span>
                </div>
                ${diffDetails ? `<div class="history-diffs">${diffDetails}</div>` : '<div class="history-diffs"><span class="h-same">Değişiklik tespit edilmedi</span></div>'}
            `;
            container.appendChild(li);
        });
    }

    function updateUI() {
        const normAcc = normalizeAcc(activeAccount);
        if (!normAcc) {
            statFollowers.innerText = '0';
            statFollowing.innerText = '0';
            statNotFollowing.innerText = '0';
            countNFB.innerText = '0';
            tabCountNFB.innerText = '0';
            countLF.innerText = '0';
            tabCountLF.innerText = '0';
            renderUserList(listNFB, [], "Lütfen bir profil seçin.");
            renderUserList(listLF, [], "Lütfen bir profil seçin.");
            renderHistoryList(listHistory, [], "Lütfen bir profil seçin.");
            return;
        }

        activeAccount = normAcc;
        const kF = `${normAcc}_followerData`;
        const kFl = `${normAcc}_followingData`;
        const kNfb = `${normAcc}_notFollowingBack`;
        const kH = `${normAcc}_history`;
        const kLFList = `${normAcc}_cumulativeLostFollowers`;
        const kLast = `${normAcc}_lastAnalyzed`;

        chrome.storage.local.get([kF, kFl, kNfb, kH, kLFList, kLast], (data) => {
            const followers = data[kF] || [];
            const following = data[kFl] || [];
            statFollowers.innerText = followers.length;
            statFollowing.innerText = following.length;

            currentNfbData = data[kNfb] || [];
            renderNfbList();

            currentLostData = data[kLFList] || [];
            renderLostList();

            currentHistoryData = data[kH] || [];
            renderHistoryList(listHistory, currentHistoryData, "Henüz geçmiş kayıt yok. 'Analizi Başlat' butonuna tıklayın.");

            if (data[kLast]) {
                const lDate = new Date(data[kLast]).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                statusText.innerText = `Son Tarama: ${lDate} (@${normAcc})`;
                statusText.style.color = "var(--text-muted)";
            } else {
                statusText.innerText = `Bu hesap henüz taranmadı (@${normAcc})`;
                statusText.style.color = "var(--text-muted)";
            }
        });
    }

    // Toplu Güvenli Takipten Çıkma Asistanı
    function triggerBatchUnfollow(count) {
        if (!currentNfbData || currentNfbData.length === 0) {
            alert("Takipten çıkılacak kullanıcı bulunamadı.");
            return;
        }

        const targetUsers = currentNfbData.slice(0, count);
        if (!confirm(`${targetUsers.length} kişi aralarda 5 saniye güvenli bekleme süresiyle takipten çıkılacak. Onaylıyor musunuz?`)) {
            return;
        }

        statusText.innerText = `🛡️ Toplu takipten çıkma başladı (0/${targetUsers.length})...`;
        statusText.style.color = "var(--primary)";
        progressBar.style.width = "10%";

        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            const activeTab = tabs[0];
            const sendBatch = (tabId) => {
                chrome.tabs.sendMessage(tabId, {
                    action: "batchUnfollow",
                    users: targetUsers,
                    sourceAccount: activeAccount
                }, (response) => {
                    if (response && response.success) {
                        statusText.innerText = `✅ ${response.count} kişi güvenle takipten çıkıldı.`;
                        statusText.style.color = "var(--success)";
                        progressBar.style.width = "100%";
                        updateUI();
                    }
                });
            };

            if (activeTab && activeTab.url && activeTab.url.includes("instagram.com")) {
                sendBatch(activeTab.id);
            } else {
                chrome.tabs.query({url: "*://*.instagram.com/*"}, (igTabs) => {
                    if (igTabs.length > 0) sendBatch(igTabs[0].id);
                    else alert("Lütfen açık bir Instagram sekmesi bulundurun.");
                });
            }
        });
    }

    btnBatch5.addEventListener('click', () => triggerBatchUnfollow(5));
    btnBatch10.addEventListener('click', () => triggerBatchUnfollow(10));

    // Manuel Analiz Başlat (Seçili Hesabı Hedef Alır)
    btnStartFullAnalysis.addEventListener('click', () => {
        if (!activeAccount) {
            statusText.innerText = "Lütfen taranacak bir hesap seçin.";
            statusText.style.color = "var(--danger)";
            return;
        }

        btnStartFullAnalysis.disabled = true;
        btnStartFullAnalysis.classList.add('loading');
        btnStartFullAnalysis.innerHTML = `<span class="spinner"></span> Analiz Yapılıyor...`;
        
        statusText.innerText = `@${activeAccount} takipçileri taranıyor...`;
        statusText.style.color = "var(--text-main)";
        progressBar.style.width = "20%";

        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            let activeTab = tabs[0];
            
            const runScrapeOnTab = (tabId) => {
                chrome.scripting.executeScript({
                    target: {tabId: tabId},
                    files: ['src/content/content.js']
                }, () => {
                    chrome.tabs.sendMessage(tabId, {
                        action: "startFullAnalysis", 
                        username: activeAccount
                    }, function(response) {
                        btnStartFullAnalysis.disabled = false;
                        btnStartFullAnalysis.classList.remove('loading');
                        btnStartFullAnalysis.innerHTML = `<span class="btn-icon">⚡</span> <span id="btn-analyze-text">@${activeAccount} Analizini Başlat</span>`;
                        
                        if (chrome.runtime.lastError || !response || !response.success) {
                            statusText.innerText = `Bağlantı Hatası: Sekmeyi yenileyin.`;
                            statusText.style.color = "var(--danger)";
                            progressBar.style.width = "0%";
                        } else {
                            statusText.innerText = `✅ @${activeAccount} Analizi Başarıyla Tamamlandı!`;
                            statusText.style.color = "var(--success)";
                            progressBar.style.width = "100%";
                            populateAccountDropdown(activeAccount);
                            updateUI();
                        }
                    });
                });
            };

            if (activeTab && activeTab.url && activeTab.url.includes("instagram.com")) {
                runScrapeOnTab(activeTab.id);
            } else {
                chrome.tabs.query({url: "*://*.instagram.com/*"}, (igTabs) => {
                    if (igTabs.length > 0) {
                        runScrapeOnTab(igTabs[0].id);
                    } else {
                        btnStartFullAnalysis.disabled = false;
                        btnStartFullAnalysis.classList.remove('loading');
                        btnStartFullAnalysis.innerHTML = `<span class="btn-icon">⚡</span> <span id="btn-analyze-text">@${activeAccount} Analizini Başlat</span>`;
                        statusText.innerText = "Lütfen açık bir Instagram sekmesi bulundurun.";
                        statusText.style.color = "var(--danger)";
                    }
                });
            }
        });
    });

    // Verileri Sıfırlama
    btnClearData.addEventListener('click', () => {
        if (!activeAccount) return;
        if (confirm(`@${activeAccount} hesabına ait tüm analiz geçmişi ve takipten çıkanlar silinecek. Emin misiniz?`)) {
            chrome.storage.local.remove([
                `${activeAccount}_currentFollowers`,
                `${activeAccount}_currentFollowing`,
                `${activeAccount}_followerData`,
                `${activeAccount}_followingData`,
                `${activeAccount}_notFollowingBack`,
                `${activeAccount}_cumulativeLostFollowers`,
                `${activeAccount}_history`,
                `${activeAccount}_lastAnalyzed`
            ], () => {
                progressBar.style.width = "0%";
                statusText.innerText = "Veriler sıfırlandı.";
                statusText.style.color = "var(--text-muted)";
                populateAccountDropdown(null);
                updateUI();
            });
        }
    });

    // İlerleme ve Batch Mesajları
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "scrapeProgress") {
            const typeLabel = request.type === 'followers' ? 'Takipçiler' : 'Takip Edilenler';
            statusText.innerText = `${typeLabel}: ${request.count} kişi çekildi...`;
            if (request.type === 'followers') progressBar.style.width = "40%";
            if (request.type === 'following') progressBar.style.width = "80%";
        } else if (request.action === "analysisStep") {
            statusText.innerText = request.text;
            if (request.step === 'following') progressBar.style.width = "60%";
            if (request.step === 'diff') progressBar.style.width = "90%";
        } else if (request.action === "analysisComplete") {
            progressBar.style.width = "100%";
            statusText.innerText = "Analiz Tamamlandı!";
            statusText.style.color = "var(--success)";
            updateUI();
        } else if (request.action === "batchUnfollowProgress") {
            statusText.innerText = `(${request.current}/${request.total}) @${request.username} takipten çıkıldı...`;
            const pct = Math.round((request.current / request.total) * 100);
            progressBar.style.width = `${pct}%`;
        } else if (request.action === "batchUnfollowComplete") {
            statusText.innerText = `✅ ${request.count} kişi takipten çıkıldı.`;
            statusText.style.color = "var(--success)";
            progressBar.style.width = "100%";
            updateUI();
        }
    });
});
