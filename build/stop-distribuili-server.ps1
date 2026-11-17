$ErrorActionPreference = 'Stop'

try {
    $roots = @(
        $env:DISTRIBUILI_INSTALL_MACHINE
        $env:DISTRIBUILI_INSTALL_USER
        $env:DISTRIBUILI_INSTALL_TARGET
    ) | Where-Object { $_ } | Select-Object -Unique

    $appName = $env:DISTRIBUILI_INSTALL_EXE
    if (-not $appName) { throw 'Missing Distribuili executable name.' }
    $appPaths = @($roots | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $_ $env:DISTRIBUILI_INSTALL_EXE)) })
    $tunnelPaths = @($roots | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $_ 'resources\client\bin\cloudflared.exe')) })

    function Stop-InstalledProcesses($name, $paths) {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            $running = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = '$name'" |
                Where-Object { $_.ExecutablePath -and $paths -contains $_.ExecutablePath })
            if ($running.Count -eq 0) { return }
            foreach ($process in $running) {
                $instance = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
                if (-not $instance) { continue }
                try {
                    Stop-Process -InputObject $instance -Force -ErrorAction Stop
                } catch {
                    if (-not $instance.HasExited) { throw }
                }
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        throw "Timed out waiting for $name to stop."
    }

    # Electron's server utility uses the desktop executable. Stop the app and
    # utility before the connector, so the tray supervisor cannot relaunch it.
    Stop-InstalledProcesses $appName $appPaths
    Stop-InstalledProcesses 'cloudflared.exe' $tunnelPaths
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
