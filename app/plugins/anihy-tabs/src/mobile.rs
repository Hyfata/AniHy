use serde::de::DeserializeOwned;
use tauri::{
    ipc::Channel,
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_anihy_tabs);

// 플러그인 초기화 — 모바일 네이티브 구현체를 등록한다.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<AnihyTabs<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("kr.hyfata.anihytabs", "AnihyTabsPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_anihy_tabs)?;
    Ok(AnihyTabs(handle))
}

/// 모바일 네이티브 탭바 구현에 대한 핸들.
/// 네이티브(iOS/Android)의 각 메서드 시그니처는
/// ios/Sources/AnihyTabsPlugin.swift / android/.../AnihyTabsPlugin.kt 와 맞춘다.
pub struct AnihyTabs<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AnihyTabs<R> {
    pub fn set_tabs(&self, tabs: Vec<TabSpec>) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("setTabs", SetTabsRequest { tabs })
            .map_err(|e| crate::Error::PluginInvoke(e.to_string()))
    }

    pub fn select_tab(&self, id: String) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("selectTab", SelectTabRequest { id })
            .map_err(|e| crate::Error::PluginInvoke(e.to_string()))
    }

    pub fn get_insets(&self) -> crate::Result<Insets> {
        self.0
            .run_mobile_plugin("getInsets", ())
            .map_err(|e| crate::Error::PluginInvoke(e.to_string()))
    }

    pub fn watch_tab_selected(&self, channel: Channel<TabSelectedEvent>) -> crate::Result<()> {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args {
            on_selected: Channel<TabSelectedEvent>,
        }
        self.0
            .run_mobile_plugin("watchTabSelected", Args { on_selected: channel })
            .map_err(|e| crate::Error::PluginInvoke(e.to_string()))
    }

    pub fn watch_insets(&self, channel: Channel<Insets>) -> crate::Result<()> {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args {
            on_insets: Channel<Insets>,
        }
        self.0
            .run_mobile_plugin("watchInsets", Args { on_insets: channel })
            .map_err(|e| crate::Error::PluginInvoke(e.to_string()))
    }
}
