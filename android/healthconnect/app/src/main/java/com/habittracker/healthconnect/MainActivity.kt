package com.habittracker.healthconnect

import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.security.GeneralSecurityException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val stepPermissions = setOf(HealthPermission.getReadPermission(StepsRecord::class))
    private lateinit var serverInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var status: TextView
    private lateinit var connectButton: Button
    private lateinit var syncButton: Button
    private lateinit var disconnectButton: Button

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { granted ->
        if (granted.containsAll(stepPermissions)) {
            readAndUploadSteps()
        } else {
            showStatus("Step access was not granted. You can review access in Health Connect settings.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        serverInput.setText(getPreferences(MODE_PRIVATE).getString("server_url", ""))
        updateConnectionControls()
    }

    private fun buildScreen() {
        val padding = (20 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }
        column.addView(TextView(this).apply {
            text = "Habit Tracker · Health Connect"
            textSize = 22f
        })
        column.addView(TextView(this).apply {
            text = "Pair using the temporary code from Connect Health Connect on the website. " +
                "Only today’s step total is imported, and it stays separate from habit progress."
            textSize = 15f
        }, matchWidth())
        serverInput = EditText(this).apply {
            hint = "Habit Tracker server URL (https://...)"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_URI
            singleLine = true
        }
        column.addView(serverInput, matchWidth())
        codeInput = EditText(this).apply {
            hint = "Pairing code"
            singleLine = true
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        }
        column.addView(codeInput, matchWidth())
        connectButton = Button(this).apply {
            text = "Pair this device"
            setOnClickListener { pairDevice() }
        }
        column.addView(connectButton, matchWidth())
        syncButton = Button(this).apply {
            text = "Allow step access and sync today"
            setOnClickListener { checkHealthConnectAndSync() }
        }
        column.addView(syncButton, matchWidth())
        disconnectButton = Button(this).apply {
            text = "Disconnect this device"
            setOnClickListener { disconnectDevice() }
        }
        column.addView(disconnectButton, matchWidth())
        status = TextView(this).apply {
            text = "Enter the server URL and pairing code from your Habit Tracker account."
            textSize = 14f
        }
        column.addView(status, matchWidth())
        setContentView(column)
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    )

    private fun updateConnectionControls() {
        val paired = hasSavedToken()
        connectButton.isEnabled = !paired
        codeInput.isEnabled = !paired
        serverInput.isEnabled = !paired
        syncButton.isEnabled = paired
        disconnectButton.isEnabled = paired
        showStatus(
            if (paired) "Device paired. Step totals are protected with the Android Keystore."
            else "Enter the server URL and pairing code from your Habit Tracker account.",
        )
    }

    private fun hasSavedToken(): Boolean = try {
        TokenStore.read(this) != null
    } catch (error: GeneralSecurityException) {
        showStatus("Saved connection could not be opened. Pair this device again.")
        TokenStore.clear(this)
        false
    } catch (error: IllegalArgumentException) {
        showStatus("Saved connection could not be opened. Pair this device again.")
        TokenStore.clear(this)
        false
    }

    private fun pairDevice() {
        val baseUrl = serverInput.text.toString().trim().trimEnd('/')
        val code = codeInput.text.toString().trim().uppercase()
        if (!baseUrl.startsWith("https://") || code.isBlank()) {
            showStatus("Enter your secure Habit Tracker server URL and the pairing code.")
            return
        }
        setBusy(true, "Pairing this device…")
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    postJson("$baseUrl/api/health-connect/exchange/", JSONObject()
                        .put("code", code)
                        .put("device_name", android.os.Build.MODEL))
                }
                TokenStore.save(this@MainActivity, result.getString("token"))
                getPreferences(MODE_PRIVATE).edit().putString("server_url", baseUrl).apply()
                codeInput.text.clear()
                showStatus("Device paired. Next, allow step access and sync today’s total.")
                updateConnectionControls()
            } catch (error: Exception) {
                showStatus(error.message ?: "Pairing failed. Check the URL and code.")
            } finally {
                setBusy(false)
            }
        }
    }

    private fun checkHealthConnectAndSync() {
        val sdkStatus = HealthConnectClient.getSdkStatus(this, HEALTH_CONNECT_PROVIDER)
        if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
            showStatus(
                if (sdkStatus == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
                    "Install or update Health Connect, then try again."
                } else {
                    "Health Connect is unavailable on this Android device."
                },
            )
            return
        }
        val client = HealthConnectClient.getOrCreate(this)
        scope.launch {
            val granted = withContext(Dispatchers.IO) {
                client.permissionController.getGrantedPermissions()
            }
            if (granted.containsAll(stepPermissions)) {
                readAndUploadSteps()
            } else {
                permissionLauncher.launch(stepPermissions)
            }
        }
    }

    private fun readAndUploadSteps() {
        setBusy(true, "Reading today’s steps…")
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@MainActivity)
                val zone = ZoneId.systemDefault()
                val date = LocalDate.now(zone)
                val start = date.atStartOfDay(zone).toInstant()
                val end = Instant.now()
                val total = withContext(Dispatchers.IO) {
                    client.aggregate(
                        AggregateRequest(
                            metrics = setOf(StepsRecord.COUNT_TOTAL),
                            timeRangeFilter = TimeRangeFilter.between(start, end),
                        ),
                    )[StepsRecord.COUNT_TOTAL] ?: 0L
                }
                val token = TokenStore.read(this@MainActivity)
                    ?: throw IOException("Pair this device with your account first.")
                val baseUrl = getPreferences(MODE_PRIVATE).getString("server_url", "")
                    ?: throw IOException("Enter the Habit Tracker server URL.")
                val offset = zone.rules.getOffset(Instant.now()).totalSeconds / 60
                withContext(Dispatchers.IO) {
                    postJson(
                        "$baseUrl/api/health-connect/steps/",
                        JSONObject()
                            .put("steps", total)
                            .put("date", date.toString())
                            .put("time_zone", zone.id)
                            .put("utc_offset_minutes", offset),
                        token,
                    )
                }
                showStatus("Synced ${"%,d".format(total)} steps for $date. Habit progress was not changed.")
            } catch (error: Exception) {
                if (error is ServerFailure && error.statusCode == 401) {
                    TokenStore.clear(this@MainActivity)
                    updateConnectionControls()
                    showStatus("This device was disconnected. Pair it again to sync steps.")
                    return@launch
                }
                showStatus(error.message ?: "Step sync failed.")
            } finally {
                setBusy(false)
            }
        }
    }

    private fun disconnectDevice() {
        val token = try {
            TokenStore.read(this)
        } catch (error: Exception) {
            showStatus("Saved connection could not be opened. Pair this device again.")
            return
        }
        val baseUrl = getPreferences(MODE_PRIVATE).getString("server_url", "")
        if (token == null || baseUrl.isNullOrBlank()) {
            showStatus("No paired device is saved.")
            return
        }
        setBusy(true, "Disconnecting…")
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    postJson("$baseUrl/api/health-connect/revoke/", JSONObject(), token)
                }
                TokenStore.clear(this@MainActivity)
                showStatus("Device disconnected.")
                updateConnectionControls()
            } catch (error: Exception) {
                if (error is ServerFailure && error.statusCode == 401) {
                    TokenStore.clear(this@MainActivity)
                    updateConnectionControls()
                    showStatus("This device was disconnected. Pair it again to sync steps.")
                    return@launch
                }
                showStatus(error.message ?: "Could not disconnect. Check your connection and retry.")
            } finally {
                setBusy(false)
            }
        }
    }

    private fun postJson(url: String, body: JSONObject, token: String? = null): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val responseCode = connection.responseCode
            val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (responseCode !in 200..299) {
                val message = try {
                    JSONObject(response).optString("error").ifBlank { "Server request failed ($responseCode)." }
                } catch (error: org.json.JSONException) {
                    "Server request failed ($responseCode)."
                }
                throw ServerFailure(responseCode, message)
            }
            return JSONObject(response)
        } finally {
            connection.disconnect()
        }
    }

    private fun setBusy(busy: Boolean, message: String? = null) {
        val paired = hasSavedToken()
        connectButton.isEnabled = !busy && !paired
        serverInput.isEnabled = !busy && !paired
        codeInput.isEnabled = !busy && !paired
        syncButton.isEnabled = !busy && paired
        disconnectButton.isEnabled = !busy && paired
        if (message != null) status.text = message
    }

    private fun showStatus(message: String) {
        status.text = message
    }

    private data class ServerFailure(val statusCode: Int, override val message: String) :
        IOException(message)

    companion object {
        private const val HEALTH_CONNECT_PROVIDER = "com.google.android.apps.healthdata"
    }
}
