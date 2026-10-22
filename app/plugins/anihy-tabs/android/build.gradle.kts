// NOTE(빌드 머신 확인 필요): AGP/Kotlin 버전과 `app.tauri:api` 의존성 해석 경로는
// `tauri android init`이 생성하는 gen/android 프로젝트의 버전 카탈로그에 맞출 것.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.7.3")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21")
    }
}

apply(plugin = "com.android.library")
apply(plugin = "kotlin-android")

group = "kr.hyfata.anihytabs"

android {
    namespace = "kr.hyfata.anihytabs"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    // Tauri Android API — `tauri android init`이 만든 로컬 maven 리포지토리에서 해석됨.
    // 버전은 gen/android의 app 모듈이 쓰는 것과 동일하게 맞출 것.
    implementation("app.tauri:api:+")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.core:core-ktx:1.13.1")
}
