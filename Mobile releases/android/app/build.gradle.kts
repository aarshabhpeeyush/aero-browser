plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.aarshabhpeeyush.aero"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.aarshabhpeeyush.aero"
        minSdk = 29
        targetSdk = 37
        versionCode = 3
        versionName = "1.1.0"
    }

    // The New Tab page is the web app in aero-mobile/app, built straight into the APK.
    sourceSets {
        getByName("main") {
            assets.srcDir("../../app")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
}
