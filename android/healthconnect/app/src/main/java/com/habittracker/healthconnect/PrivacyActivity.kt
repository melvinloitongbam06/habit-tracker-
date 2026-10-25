package com.habittracker.healthconnect

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class PrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(
            TextView(this).apply {
                text = "Habit Tracker reads your step count from Health Connect only after you grant permission. " +
                    "When you tap Sync, today’s total and local date are sent to your Habit Tracker server. " +
                    "The data is displayed separately and does not change your habits. You can disconnect " +
                    "the device from either this app or your Habit Tracker account."
                textSize = 18f
                setPadding(32, 32, 32, 32)
            },
        )
    }
}
