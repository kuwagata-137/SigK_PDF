'use strict';

// メニュー「ヘルプ」→「既定のアプリの設定…」で開く、Windows の設定の URI（docs/spec-5-2-open-with-icon.md 確定事項C2）。
//
// Windows 10 以降、アプリが自分で既定のアプリになることはできない（docs/03 1-3）。設定の画面を開き、本人に選んでもらう。
// registeredAppUser には、インストーラーが HKCU\Software\RegisteredApplications に書いた値の名前（製品名）を渡す。
// 名前が一覧に無いとき（開発ツリー・古い Windows）は、既定のアプリの画面の頭が開く見込み。

const DEFAULT_APPS_URI = 'ms-settings:defaultapps';

function defaultAppsUri(appName) {
  if (typeof appName !== 'string' || appName.trim() === '')
    return DEFAULT_APPS_URI;
  return `${DEFAULT_APPS_URI}?registeredAppUser=${encodeURIComponent(appName)}`;
}

module.exports = { DEFAULT_APPS_URI, defaultAppsUri };
