package com.remotex.pro

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                var code by remember { mutableStateOf("") }
                var status by remember { mutableStateOf("Ready — enter a session code to request access.") }
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("RemoteX Pro", style = MaterialTheme.typography.headlineMedium)
                        Text("Secure remote support")
                        OutlinedTextField(value = code, onValueChange = { code = it.uppercase().take(10) }, label = { Text("Session code") })
                        Button(onClick = { status = if (code.isBlank()) "Enter a valid session code." else "Request flow is a UI placeholder. Connect the Android WebRTC client before use." }) {
                            Text("Request connection")
                        }
                        Text(status)
                        Text("Android screen sharing must use the system MediaProjection consent dialog. This starter does not capture or control the device.")
                    }
                }
            }
        }
    }
}
