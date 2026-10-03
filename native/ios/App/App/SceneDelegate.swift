import UIKit
import Capacitor

class AniHyBridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // safe area 인셋 이중 적용 방지 (페이지가 viewport-fit=cover + env()로 직접 처리)
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        // OS 기본 러버밴드 바운스 명시적 활성화 (기본값 true지만 방어적으로 고정)
        webView?.scrollView.bounces = true
        webView?.scrollView.alwaysBounceVertical = true

        // iOS 26+에서 env(safe-area-inset-*)이 전체화면/회전 후 고착되는 버그 우회:
        // UIKit이 아는 진짜 inset을 CSS 변수(--anihy-sat/sar/sab/sal)로 주입한다.
        // WKUserScript는 매 네비게이션마다 다시 주입되고, 로드 완료 시 'ready'를
        // 본낸 뒤 네이티브가 현재 inset을 푸시하는 구조라 페이지 이동에도 자가 복구됨.
        let injectJS = """
        window.__anihySetInsets = function (t, r, b, l) {
            var s = document.documentElement.style;
            s.setProperty('--anihy-sat', t + 'px');
            s.setProperty('--anihy-sar', r + 'px');
            s.setProperty('--anihy-sab', b + 'px');
            s.setProperty('--anihy-sal', l + 'px');
        };
        try { window.webkit.messageHandlers.anihyInsets.postMessage('ready'); } catch (e) {}
        """
        let script = WKUserScript(source: injectJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
        webView?.configuration.userContentController.add(self, name: "anihyInsets")
        webView?.configuration.userContentController.add(self, name: "anihyStatusBar")
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "anihyInsets")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "anihyStatusBar")
    }

    // JS(fullscreen.js)가 전체화면 진입/해제 시 병내는 상태바 숨김 직접 채널.
    // @capacitor/status-bar는 iPadOS 26에서 동작하지 않아 네이티브에서 직접 제어
    private var anihyStatusBarHidden = false
    override var prefersStatusBarHidden: Bool {
        return anihyStatusBarHidden
    }

    private func pushSafeAreaVars() {
        guard let webView = webView else { return }
        let i = view.safeAreaInsets
        // iOS 26+는 전체화면/회전 후 view.safeAreaInsets 자체가 0으로 고착될 수 있음.
        // 상태바가 보이는 동안은 statusBarFrame이 정확하므로 top은 둘 중 큰 값을 사용
        var top = i.top
        if let scene = view.window?.windowScene, scene.statusBarManager?.isStatusBarHidden == false,
           let h = scene.statusBarManager?.statusBarFrame.height {
            top = max(top, h)
        }
        let js = "window.__anihySetInsets && window.__anihySetInsets(\(top),\(i.right),\(i.bottom),\(i.left))"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // iOS 26+ 버그(WebKit 297779, capacitor#8231) 우회: 전체화면 해제·회전 후
    // WebKit이 safe area/뷰포트 재계산을 못 해 fixed 요소가 OS 상태바와 겹치는 문제.
    // 네이티브에서 WebView 프레임 재설정 + 진짜 inset 푸시로 재계산을 강제한다.
    private func forceWebViewRelayout() {
        guard let webView = webView else { return }
        webView.frame = view.bounds
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        pushSafeAreaVars()
        webView.evaluateJavaScript("window.dispatchEvent(new Event('resize'))", completionHandler: nil)
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.forceWebViewRelayout()
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        pushSafeAreaVars()
        // 상태바 hide/show 등 inset 변화 후 프레임이 어긋난 경우만 복원
        if let webView = webView, webView.frame != view.bounds {
            forceWebViewRelayout()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        pushSafeAreaVars()
    }
}

extension AniHyBridgeViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "anihyInsets" {
            pushSafeAreaVars()
        }
        if message.name == "anihyStatusBar", let body = message.body as? String {
            anihyStatusBarHidden = (body == "hide")
            setNeedsStatusBarAppearanceUpdate()
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AniHyBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
