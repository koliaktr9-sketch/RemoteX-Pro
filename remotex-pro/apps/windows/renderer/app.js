const $ = id => document.getElementById(id);
function setStatus(s) {
  $('status').textContent = s.state.toUpperCase();
  $('detail').textContent = s.message || '';
  $('status').className = `pill ${s.state}`;
}
window.remoteX.onStatus(setStatus);
$('pair').addEventListener('click', async () => {
  const button = $('pair'); button.disabled = true;
  try {
    await window.remoteX.pair($('deviceId').value.trim(), $('pairingSecret').value.trim());
    $('pairingSecret').value = '';
    $('detail').textContent = 'Device paired. The one-time secret has been cleared from this form.';
  } catch (e) { $('detail').textContent = `Pairing failed: ${e.message}`; }
  finally { button.disabled = false; }
});
$('restore').addEventListener('click', async () => { try { await window.remoteX.restore(); } catch (e) { $('detail').textContent = e.message; } });
$('pause').addEventListener('click', async () => { await window.remoteX.disconnect(false); });
$('forget').addEventListener('click', async () => {
  if (confirm('Erase the locally stored device refresh credential? You will need to pair this device again.')) await window.remoteX.disconnect(true);
});
let stream = null;
$('capture').addEventListener('click', async () => {
  if (!confirm('You are the host. Continue to the system screen picker and choose exactly what to share?')) return;
  try {
    // User gesture + confirmation + browser/Electron native picker. No capture on startup.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    $('captureState').textContent = 'Local screen capture is active. No remote peer is connected in this build.';
    $('stopCapture').disabled = false;
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', stopCapture));
  } catch (e) { $('captureState').textContent = `Capture cancelled or unavailable: ${e.message}`; }
});
function stopCapture() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; $('stopCapture').disabled = true; $('captureState').textContent = 'Screen sharing is off.'; }
$('stopCapture').addEventListener('click', stopCapture);
window.addEventListener('beforeunload', stopCapture);
