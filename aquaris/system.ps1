# Aquaris's system helper (Windows). Aquaris starts this hidden while its quick settings are used,
# and talks to it one line at a time: it sends {"id":1,"cmd":"getVolume","args":{...}} and gets back
# {"id":1,"ok":true,"data":...}. Only the commands below exist; values from Aquaris (like a Wi-Fi
# name or password) are only ever used as data, never run as code.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

# ---------- Volume: Windows' audio system ----------
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class AquarisAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Get() { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void Set(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty)); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void Mute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, System.Guid.Empty)); }
}
'@

# ---------- Windows' newer parts (radios, Bluetooth), used from PowerShell ----------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(30000)
  $task.Result
}
$null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]

function Get-Radios {
  $null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
  Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}
function Set-Radio([string]$kind, [bool]$on) {
  $radio = Get-Radios | Where-Object { $_.Kind.ToString() -eq $kind } | Select-Object -First 1
  if (-not $radio) { throw "No $kind on this computer" }
  $state = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  (Await ($radio.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])).ToString()
}

function Find-Bluetooth([bool]$paired) {
  $list = @()
  foreach ($sel in @([Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($paired),
                     [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($paired))) {
    $found = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
    foreach ($d in $found) { if ($d.Name) { $list += @{ id = $d.Id; name = $d.Name; paired = $paired; canPair = $d.Pairing.CanPair } } }
  }
  $list
}

# ---------- Wi-Fi: Windows' netsh tool ----------
function Get-WifiNetworks {
  $text = (netsh wlan show networks mode=bssid) -join "`n"
  if ($text -match 'location') { throw 'LOCATION' }
  $nets = @()
  foreach ($block in ($text -split "(?m)^SSID \d+ : ")) {
    if ($block -notmatch 'Authentication') { continue }
    $name = ($block -split "`n")[0].Trim()
    $auth = if ($block -match 'Authentication\s*:\s*(.+)') { $Matches[1].Trim() } else { '' }
    $signal = if ($block -match 'Signal\s*:\s*(\d+)%') { [int]$Matches[1] } else { 0 }
    if ($name) { $nets += @{ ssid = $name; auth = $auth; signal = $signal; open = ($auth -eq 'Open') } }
  }
  $known = (netsh wlan show profiles) | Select-String 'All User Profile\s*:\s*(.+)$' | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() }
  foreach ($n in $nets) { $n.known = $known -contains $n.ssid }
  $nets | Sort-Object { -$_.signal }
}
function Get-WifiNow {
  $text = (netsh wlan show interfaces) -join "`n"
  $state = if ($text -match '(?m)^\s*State\s*:\s*(.+)$') { $Matches[1].Trim() } else { 'none' }
  $ssid = if ($text -match '(?m)^\s*SSID\s*:\s*(.+)$') { $Matches[1].Trim() } else { '' }
  $signal = if ($text -match 'Signal\s*:\s*(\d+)%') { [int]$Matches[1] } else { 0 }
  @{ state = $state; ssid = $ssid; signal = $signal }
}
function Connect-Wifi([string]$ssid, [string]$password) {
  $known = (netsh wlan show profiles) | Select-String 'All User Profile\s*:\s*(.+)$' | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() }
  if (-not ($known -contains $ssid)) {
    # A new network: make a Windows Wi-Fi profile for it (then delete the temporary file)
    $name = [Security.SecurityElement]::Escape($ssid)
    if ($password) {
      $key = [Security.SecurityElement]::Escape($password)
      $security = "<authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>$key</keyMaterial></sharedKey>"
    } else {
      $security = "<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>"
    }
    $xml = "<?xml version=`"1.0`"?><WLANProfile xmlns=`"http://www.microsoft.com/networking/WLAN/profile/v1`"><name>$name</name><SSIDConfig><SSID><name>$name</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security>$security</security></MSM></WLANProfile>"
    $file = Join-Path $env:TEMP ("aquaris-wifi-" + [guid]::NewGuid() + ".xml")
    try {
      [IO.File]::WriteAllText($file, $xml)
      $out = netsh wlan add profile filename="$file" user=current
    } finally { Remove-Item $file -ErrorAction SilentlyContinue }
  }
  $out = (netsh wlan connect name="$ssid") -join ' '
  Start-Sleep -Seconds 4
  @{ result = $out; now = (Get-WifiNow) }
}

# ---------- Brightness: built-in screens (laptops) only ----------
function Get-Brightness {
  try { [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { $null }
}
function Set-Brightness([int]$level) {
  $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
  if (-not $m) { throw 'This screen does not let Windows change its brightness' }
  $null = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte][Math]::Max(0, [Math]::Min(100, $level)) }
}

# ---------- The command loop ----------
Write-Output (@{ id = 0; ok = $true; data = 'ready' } | ConvertTo-Json -Compress)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $a = $req.args
    $data = switch ($req.cmd) {
      'getVolume'     { @{ level = [Math]::Round([AquarisAudio]::Get() * 100); muted = [AquarisAudio]::Muted() } }
      'setVolume'     { [AquarisAudio]::Set([float]([Math]::Max(0, [Math]::Min(100, [int]$a.level)) / 100)); $true }
      'setMute'       { [AquarisAudio]::Mute([bool]$a.muted); $true }
      'getBrightness' { Get-Brightness }
      'setBrightness' { Set-Brightness ([int]$a.level); $true }
      'radios'        { @(Get-Radios | ForEach-Object { @{ kind = $_.Kind.ToString(); state = $_.State.ToString() } }) }
      'setRadio'      { Set-Radio ([string]$a.kind) ([bool]$a.on) }
      'wifiNow'       { Get-WifiNow }
      'wifiList'      { @(Get-WifiNetworks) }
      'wifiConnect'   { Connect-Wifi ([string]$a.ssid) ([string]$a.password) }
      'wifiDisconnect'{ (netsh wlan disconnect) -join ' ' }
      'btPaired'      { @(Find-Bluetooth $true) }
      'btScan'        { @(Find-Bluetooth $false) }
      'btPair'        {
        $d = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync([string]$a.id)) ([Windows.Devices.Enumeration.DeviceInformation])
        (Await ($d.Pairing.PairAsync()) ([Windows.Devices.Enumeration.DevicePairingResult])).Status.ToString()
      }
      'btUnpair'      {
        $d = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync([string]$a.id)) ([Windows.Devices.Enumeration.DeviceInformation])
        (Await ($d.Pairing.UnpairAsync()) ([Windows.Devices.Enumeration.DeviceUnpairingResult])).Status.ToString()
      }
      'battery'       {
        $b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($b) { @{ level = [int]$b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -in 2, 6, 7, 8, 9) } } else { $null }
      }
      'recycle'       {
        # Move a file or folder to the Recycle Bin (it can be got back)
        Add-Type -AssemblyName Microsoft.VisualBasic
        $path = [string]$a.path
        if (Test-Path -LiteralPath $path -PathType Container) {
          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
        } elseif (Test-Path -LiteralPath $path) {
          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
        } else { throw 'It is not there any more' }
        $true
      }
      default         { throw "Unknown command" }
    }
    Write-Output (@{ id = $id; ok = $true; data = $data } | ConvertTo-Json -Compress -Depth 5)
  } catch {
    Write-Output (@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
  }
}
