const SCAN_INTERVAL = 10000;
const CLICK_DELAY = 1000;
// 您設定的目標學習平台網址關鍵字
const TARGET_URL_KEYWORD = 'https://ltc-learning.org/learn/';

// 用於追蹤哪些分頁正在被掃描，防止重複啟動
let scanningTabs = new Set();

// --------------------
// 主要功能函式
// --------------------

// 1. 繞過可見性偵測的腳本 (注入到頁面)
const bypassVisibilityCheck = () => {
  console.log('[Bypass-Injected] 執行繞過腳本...');
  try {
    Object.defineProperty(document, 'hidden', { value: false, writable: false });
    console.log('[Bypass-Injected] 已覆寫 document.hidden');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
    console.log('[Bypass-Injected] 已覆寫 document.visibilityState');
    window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    console.log('[Bypass-Injected] 已附加 visibilitychange 監聽器');
    console.log('[Bypass-Injected] 成功繞過頁面可見性偵測。');
  } catch (e) {
    console.error("[Bypass-Injected] 繞過腳本出錯:", e);
  }
};

// 2. 核心掃描與點擊函式 (遞迴執行)
async function scanAndClick(tabId) {
  const { isScanning } = await chrome.storage.local.get("isScanning");
  if (!isScanning || !scanningTabs.has(tabId)) {
    console.log(`[Auto-Click] 停止掃描分頁 (ID: ${tabId})`);
    scanningTabs.delete(tabId);
    return;
  }

  console.log(`[Auto-Click] 正在掃描分頁 (ID: ${tabId})`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const dialogFrame = document.getElementById("s_dialog");
        if (!dialogFrame) return;
        const dialogDoc = dialogFrame.contentDocument || dialogFrame.contentWindow.document;
        const confirmButton = dialogDoc.querySelector("input.cssBtn[value='確認']");
        if (confirmButton) {
          setTimeout(() => confirmButton.click(), 1000);
          console.log("已自動點擊確認按鈕！");
        }
      }
    });
  } catch (err) {
    console.error(`[Auto-Click] 掃描分頁 (ID: ${tabId}) 時出錯，可能分頁已關閉:`, err.message);
    scanningTabs.delete(tabId);
    return;
  }

  setTimeout(() => scanAndClick(tabId), 10000);
}

// 3. 啟動所有自動化功能的統一入口
async function startAutomationForTab(tabId) {
  if (scanningTabs.has(tabId)) {
    return;
  }
  console.log(`[Controller] 為分頁 (ID: ${tabId}) 啟動自動化...`);
  scanningTabs.add(tabId);
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: bypassVisibilityCheck,
    world: 'MAIN'
  }, () => {
    if (chrome.runtime.lastError) {
      console.error(`[Bypass-Listener] 腳本注入失敗 (Tab ID: ${tabId}):`, chrome.runtime.lastError.message);
    } else {
      console.log(`[Bypass-Listener] 腳本成功注入至分頁 (ID: ${tabId})。`);
    }
  });
  scanAndClick(tabId);
}

// --- 新增功能：檢查符合條件的分頁數量，並據此設定總開關狀態 ---
async function checkAndSetSwitchState() {
  const tabs = await chrome.tabs.query({ url: `${TARGET_URL_KEYWORD}*` });
  if (tabs.length === 0) {
    const { isScanning } = await chrome.storage.local.get("isScanning");
    if (isScanning) {
        console.log("[Master-Switch] 未偵測到符合的分頁，自動將總開關設為 [停用]。");
        await chrome.storage.local.set({ isScanning: false });
        await chrome.action.setTitle({ title: "🔴停止中 點擊以啟用" });
        scanningTabs.clear();
    }
  }
}

// --------------------
// 事件監聽器
// --------------------

// 1. 安裝時：預設為啟用狀態
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isScanning: true });
  chrome.action.setTitle({ title: "🟢啟用中 點擊以停止" });
  console.log("擴充功能已安裝，預設為啟用狀態。");
});

// 2. 瀏覽器啟動時：檢查已開啟的分頁
chrome.runtime.onStartup.addListener(async () => {
  console.log("瀏覽器啟動，檢查現有分頁...");
  const { isScanning } = await chrome.storage.local.get("isScanning");
  if (isScanning) {
    const tabs = await chrome.tabs.query({ url: `${TARGET_URL_KEYWORD}*` });
    if (tabs.length > 0) {
        for (const tab of tabs) {
          startAutomationForTab(tab.id);
        }
    } else {
        checkAndSetSwitchState(); // 如果沒有符合的分頁，也更新一下開關狀態
    }
  }
});

// 3. 分頁更新時：主要觸發點
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const { isScanning } = await chrome.storage.local.get("isScanning");
    if (isScanning && tab.url && tab.url.startsWith(TARGET_URL_KEYWORD)) {
      console.log(`[Controller] 偵測到目標分頁 (ID: ${tabId}) 已載入完成。`);
      startAutomationForTab(tabId);
    }
    // 每次有分頁載入完成後，都檢查一次狀態，以處理從目標網站導覽到其他網站的情況
    checkAndSetSwitchState();
  }
});

// 4. 分頁關閉時：清理追蹤列表並檢查開關狀態
chrome.tabs.onRemoved.addListener((tabId) => {
  if (scanningTabs.has(tabId)) {
    scanningTabs.delete(tabId);
    console.log(`分頁 (ID: ${tabId}) 已關閉，停止追蹤。`);
  }
  // 延遲一小段時間再檢查，確保分頁列表已更新
  setTimeout(checkAndSetSwitchState, 100);
});

// 5. 點擊圖示時：切換總開關
chrome.action.onClicked.addListener(async (tab) => {
  const { isScanning } = await chrome.storage.local.get("isScanning");
  const newState = !isScanning;

  await chrome.storage.local.set({ isScanning: newState });

  if (newState) {
    await chrome.action.setTitle({ title: "🟢啟用中 點擊以停止" });
    console.log("---總開關已手動設為 [啟用]--- 現在將自動掃描符合條件的分頁。");
    // 當從手動關閉變為開啟時，主動檢查一次當前分頁
    if (tab.url && tab.url.startsWith(TARGET_URL_KEYWORD)) {
        startAutomationForTab(tab.id);
    }
  } else {
    await chrome.action.setTitle({ title: "🔴停止中 點擊以啟用" });
    console.log("---總開關已手動設為 [停用]--- 所有掃描將會停止。");
    scanningTabs.clear();
  }
});

