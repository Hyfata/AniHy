use serde::{Deserialize, Serialize};

/// JS가 네이티브 탭바에 등록하는 탭 하나.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSpec {
    /// 탭 식별자 (라우트와 1:1 대응, 예: "home")
    pub id: String,
    /// 탭 레이블 (예: "홈")
    pub label: String,
    /// SF Symbol 이름(iOS) / material 아이콘 키(Android 매핑표 참고).
    /// 예: "house", "calendar", "magnifyingglass", "square.stack"
    pub icon: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTabsRequest {
    pub tabs: Vec<TabSpec>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectTabRequest {
    pub id: String,
}

/// 네이티브 safe-area inset (CSS px 기준).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// 네이티브 탭바에서 탭이 선택됐을 때 JS로 전달되는 페이로드.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSelectedEvent {
    pub id: String,
}
