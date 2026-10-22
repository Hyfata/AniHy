use serde::de::DeserializeOwned;
use tauri::{ipc::Channel, plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<AnihyTabs<R>> {
    Ok(AnihyTabs(app.clone()))
}

/// 데스크톱 스텁 — 네이티브 탭바는 모바일 전용. 커맨드는 no-op으로 성공시켜
/// 웹 코드가 플랫폼 분기 없이 호출필 수 있게 한다.
pub struct AnihyTabs<R: Runtime>(AppHandle<R>);

impl<R: Runtime> AnihyTabs<R> {
    pub fn set_tabs(&self, _tabs: Vec<TabSpec>) -> crate::Result<()> {
        Ok(())
    }

    pub fn select_tab(&self, _id: String) -> crate::Result<()> {
        Ok(())
    }

    pub fn get_insets(&self) -> crate::Result<Insets> {
        Ok(Insets::default())
    }

    pub fn watch_tab_selected(&self, _channel: Channel<TabSelectedEvent>) -> crate::Result<()> {
        Ok(())
    }

    pub fn watch_insets(&self, channel: Channel<Insets>) -> crate::Result<()> {
        channel.send(Insets::default())?;
        Ok(())
    }
}
