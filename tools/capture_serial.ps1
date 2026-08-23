param(
    [Parameter(Mandatory = $true)][string]$Port,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [int]$DurationSeconds = 300,
    [int]$BaudRate = 115200
)

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$parent = [System.IO.Path]::GetDirectoryName($resolvedOutput)
if ($parent) {
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
}

$serial = [System.IO.Ports.SerialPort]::new($Port, $BaudRate, 'None', 8, 'One')
$serial.ReadTimeout = 500
$serial.DtrEnable = $false
$serial.RtsEnable = $false

try {
    $serial.Open()
    $deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $chunk = $serial.ReadExisting()
        if ($chunk) {
            [System.IO.File]::AppendAllText(
                $resolvedOutput,
                $chunk,
                [System.Text.UTF8Encoding]::new($false)
            )
        }
        Start-Sleep -Milliseconds 50
    }
}
finally {
    if ($serial.IsOpen) {
        $serial.Close()
    }
}
