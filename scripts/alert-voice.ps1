$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    try {
      $request = $line | ConvertFrom-Json
      if ($request.action -eq 'voices') {
        $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name } })
        @{ id = $request.id; voices = $voices } | ConvertTo-Json -Depth 4 -Compress
      } elseif ($request.action -eq 'speak') {
        if ($request.voice) { $speaker.SelectVoice($request.voice) }
        $speaker.Rate = [Math]::Max(-10, [Math]::Min(10, [int][Math]::Round(6 * [Math]::Log([double]$request.speed, 2))))
        $speaker.Volume = [int][Math]::Round(100 * [double]$request.volume)
        $speaker.SpeakAsyncCancelAll()
        $null = $speaker.SpeakAsync([string]$request.text)
        @{ id = $request.id; ok = $true } | ConvertTo-Json -Compress
      } elseif ($request.action -eq 'stop') {
        $speaker.SpeakAsyncCancelAll()
        @{ id = $request.id; ok = $true } | ConvertTo-Json -Compress
      } else { throw 'Unsupported voice operation.' }
    } catch {
      @{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    [Console]::Out.Flush()
  }
} finally { $speaker.SpeakAsyncCancelAll(); $speaker.Dispose() }
