package kr.hyfata.anihytabs

import android.app.Activity
import android.util.DisplayMetrics
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.material.bottomnavigation.BottomNavigationView

@InvokeArg
class TabSpec {
    lateinit var id: String
    lateinit var label: String
    lateinit var icon: String
}

@InvokeArg
class SetTabsArgs {
    lateinit var tabs: Array<TabSpec>
}

@InvokeArg
class SelectTabArgs {
    lateinit var id: String
}

@InvokeArg
class WatchTabSelectedArgs {
    lateinit var onSelected: Channel
}

@InvokeArg
class WatchInsetsArgs {
    lateinit var onInsets: Channel
}

/**
 * AniHy 네이티브 탭바 플러그인 (Android).
 * 액티비티 콘텐츠 뷰 위에 BottomNavigationView를 오버레이하고,
 * 탭 선택/safe-area inset을 JS 채널로 푸시한다.
 * 웹 콘텐츠는 하단 inset을 CSS 변수(--anihy-sab)로 받아 탭바 높이만큼 패딩을 넣는다.
 */
@TauriPlugin
class AnihyTabsPlugin(private val activity: Activity) : Plugin(activity) {

    private var navView: BottomNavigationView? = null
    private var tabs: Array<TabSpec> = emptyArray()
    private var tabSelectedChannel: Channel? = null
    private var insetsChannel: Channel? = null

    /** iOS SF Symbol 키 → Android 내장 드로어블 매핑 (material 아이콘으로 교체 가능). */
    private fun iconResFor(key: String): Int = when (key) {
        "house" -> android.R.drawable.ic_menu_view
        "calendar" -> android.R.drawable.ic_menu_my_calendar
        "magnifyingglass" -> android.R.drawable.ic_menu_search
        "square.stack" -> android.R.drawable.ic_menu_agenda
        else -> android.R.drawable.ic_menu_help
    }

    private fun pxToDp(px: Int): Double {
        val density = activity.resources.displayMetrics.density
        return px / density.toDouble()
    }

    @Command
    fun setTabs(invoke: Invoke) {
        val args = invoke.parseArgs(SetTabsArgs::class.java)
        tabs = args.tabs
        activity.runOnUiThread {
            installNavView()
            invoke.resolve()
        }
    }

    @Command
    fun selectTab(invoke: Invoke) {
        val args = invoke.parseArgs(SelectTabArgs::class.java)
        activity.runOnUiThread {
            val index = tabs.indexOfFirst { it.id == args.id }
            navView?.let { nav ->
                if (index >= 0 && index < nav.menu.size()) {
                    nav.selectedItemId = nav.menu.getItem(index).itemId
                }
            }
            invoke.resolve()
        }
    }

    @Command
    fun getInsets(invoke: Invoke) {
        activity.runOnUiThread {
            invoke.resolve(currentInsets())
        }
    }

    @Command
    fun watchTabSelected(invoke: Invoke) {
        val args = invoke.parseArgs(WatchTabSelectedArgs::class.java)
        tabSelectedChannel = args.onSelected
        invoke.resolve()
    }

    @Command
    fun watchInsets(invoke: Invoke) {
        val args = invoke.parseArgs(WatchInsetsArgs::class.java)
        insetsChannel = args.onInsets
        activity.runOnUiThread {
            // 시스템 바 inset 변화(회전, 제스처 낸비게이션 전환 등)를 푸시
            val decor = activity.window.decorView
            ViewCompat.setOnApplyWindowInsetsListener(decor) { v, insets ->
                v.post { pushInsets() }
                insets
            }
            pushInsets()
            invoke.resolve()
        }
    }

    private fun installNavView() {
        // 기존 뷰 제거 후 재구성 (setTabs 재호출 대응)
        navView?.let { (it.parent as? ViewGroup)?.removeView(it) }

        val nav = BottomNavigationView(activity)
        tabs.forEachIndexed { index, tab ->
            nav.menu.add(0, index, index, tab.label).setIcon(iconResFor(tab.icon))
        }
        nav.setOnItemSelectedListener { item ->
            val index = item.itemId
            if (index in tabs.indices) {
                // TODO(빌드 머신 검증): Channel 전송 API가 버전에 따라 다를 수 있음
                val payload = JSObject()
                payload.put("id", tabs[index].id)
                tabSelectedChannel?.send(payload)
            }
            true
        }

        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        val params = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.Gravity.BOTTOM
        )
        content.addView(nav, params)
        navView = nav
        nav.post { pushInsets() }
    }

    /** 웹에 전달할 inset (CSS px = dp 단위로 변환). bottom은 시스템 바 + 탭바 높이 합산. */
    private fun currentInsets(): JSObject {
        val decor = activity.window.decorView
        val insets = ViewCompat.getRootWindowInsets(decor)
        val bars = insets?.getInsets(WindowInsetsCompat.Type.systemBars())
        val navHeight = navView?.height ?: 0
        val obj = JSObject()
        obj.put("top", pxToDp(bars?.top ?: 0))
        obj.put("right", pxToDp(bars?.right ?: 0))
        obj.put("bottom", pxToDp((bars?.bottom ?: 0) + navHeight))
        obj.put("left", pxToDp(bars?.left ?: 0))
        return obj
    }

    private fun pushInsets() {
        insetsChannel?.send(currentInsets())
    }
}
