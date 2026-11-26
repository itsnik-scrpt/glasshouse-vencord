<# :
@echo off
set "GH_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -Command "iex ([IO.File]::ReadAllText($env:GH_SELF))"
exit /b
#>

# Glasshouse setup for Windows.
#
# Double-click this file. It downloads the latest Glasshouse build (Vencord with the
# Glasshouse plugin inside) from this project's GitHub releases, patches Discord to load
# it using Vencord's own installer, and turns the plugin and theme on. After that,
# Discord keeps Glasshouse up to date by itself.
#
# Everything it installs lives in %LOCALAPPDATA%\Glasshouse. Your Vencord settings stay
# where they are, in %APPDATA%\Vencord, and a backup of the settings file is made first.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo        = 'itsnik-scrpt/glasshouse-vencord'
$PatcherUrl  = 'https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe'
$Root        = Join-Path $env:LOCALAPPDATA 'Glasshouse'
$Dist        = Join-Path $Root 'dist'
$Tools       = Join-Path $Root 'tools'
$Stamp       = Join-Path $Root 'installed.json'
$VencordData = Join-Path $env:APPDATA 'Vencord'
$BuildFiles  = 'patcher.js', 'preload.js', 'renderer.js', 'renderer.css'
$ThemeFile   = 'Glasshouse.theme.css'

# Test switches: GH_DRYRUN downloads but changes nothing; GH_SNAPSHOT saves a picture of the window and exits.
$DryRun   = [bool]$env:GH_DRYRUN
$Snapshot = $env:GH_SNAPSHOT

$Channels = @(@(
    @{ Name = 'Discord';        Folder = 'Discord';       Branch = 'stable' },
    @{ Name = 'Discord PTB';    Folder = 'DiscordPTB';    Branch = 'ptb' },
    @{ Name = 'Discord Canary'; Folder = 'DiscordCanary'; Branch = 'canary' }
) | Where-Object { Test-Path (Join-Path $env:LOCALAPPDATA (Join-Path $_.Folder 'Update.exe')) })

$S = @{ Latest = $null; Installed = $null; Busy = $false; Done = $false }

# ---------------------------------------------------------------- window

[xml]$Xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Glasshouse Setup" Width="780" Height="500" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" ResizeMode="NoResize" WindowStartupLocation="CenterScreen"
        FontFamily="Segoe UI Variable Text, Segoe UI" Foreground="White" UseLayoutRounding="True">
  <Window.Resources>
    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Foreground" Value="White"/>
      <Setter Property="FontSize" Value="15"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="B" CornerRadius="13" Background="#E8409A" Padding="26,0" Height="46">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="B" Property="Background" Value="#F45AAE"/></Trigger>
              <Trigger Property="IsPressed" Value="True"><Setter TargetName="B" Property="Background" Value="#D2338A"/></Trigger>
              <Trigger Property="IsEnabled" Value="False"><Setter TargetName="B" Property="Opacity" Value="0.45"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Quiet" TargetType="Button">
      <Setter Property="Foreground" Value="#C9B8D4"/>
      <Setter Property="FontSize" Value="14"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="B" CornerRadius="13" Background="Transparent" BorderBrush="#40FFFFFF" BorderThickness="1" Padding="20,0" Height="46">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="B" Property="Background" Value="#18FFFFFF"/>
                <Setter Property="Foreground" Value="White"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False"><Setter TargetName="B" Property="Opacity" Value="0.45"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Close" TargetType="Button">
      <Setter Property="Foreground" Value="#B9A9C4"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Grid Background="Transparent" Width="40" Height="40">
              <Path Data="M0,0 L12,12 M12,0 L0,12" Stroke="{TemplateBinding Foreground}" StrokeThickness="1.8"
                    StrokeStartLineCap="Round" StrokeEndLineCap="Round" HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True"><Setter Property="Foreground" Value="White"/></Trigger>
      </Style.Triggers>
    </Style>
    <Style x:Key="Channel" TargetType="ToggleButton">
      <Setter Property="Foreground" Value="#C9B8D4"/>
      <Setter Property="FontSize" Value="13.5"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Margin" Value="0,0,8,0"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ToggleButton">
            <Border x:Name="B" CornerRadius="10" Background="Transparent" BorderBrush="#40FFFFFF" BorderThickness="1" Padding="14,0" Height="34">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsChecked" Value="True">
                <Setter TargetName="B" Property="BorderBrush" Value="#FF5FAE"/>
                <Setter TargetName="B" Property="Background" Value="#30FF5FAE"/>
                <Setter Property="Foreground" Value="White"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Border x:Name="Shell" CornerRadius="22" BorderBrush="#33FFFFFF" BorderThickness="1" Background="#170D1D" ClipToBounds="True">
    <Grid>
      <!-- backdrop: the same three glows as the Glasshouse banner -->
      <Border CornerRadius="22">
        <Border.Background>
          <RadialGradientBrush Center="0.05,0" GradientOrigin="0.05,0" RadiusX="0.75" RadiusY="0.95">
            <GradientStop Color="#E0B01A6E" Offset="0"/><GradientStop Color="#00B01A6E" Offset="1"/>
          </RadialGradientBrush>
        </Border.Background>
      </Border>
      <Border CornerRadius="22">
        <Border.Background>
          <RadialGradientBrush Center="0.98,1" GradientOrigin="0.98,1" RadiusX="0.7" RadiusY="0.95">
            <GradientStop Color="#D05A1FB0" Offset="0"/><GradientStop Color="#005A1FB0" Offset="1"/>
          </RadialGradientBrush>
        </Border.Background>
      </Border>
      <Border CornerRadius="22">
        <Border.Background>
          <RadialGradientBrush Center="0.78,0" GradientOrigin="0.78,0" RadiusX="0.42" RadiusY="0.6">
            <GradientStop Color="#90C4183F" Offset="0"/><GradientStop Color="#00C4183F" Offset="1"/>
          </RadialGradientBrush>
        </Border.Background>
      </Border>

      <Button x:Name="CloseButton" Style="{StaticResource Close}" HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,10,10,0"/>

      <Grid Margin="56,58,56,44">
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <Canvas x:Name="Logo" Grid.Row="0" Height="96" HorizontalAlignment="Left">
          <Path x:Name="LogoLine" Stroke="#FF5FAE" StrokeThickness="2.2" StrokeLineJoin="Round"/>
          <Path x:Name="LogoFill" Fill="White"/>
        </Canvas>

        <TextBlock Grid.Row="1" Text="Your Discord, rebuilt. One hub, a server picker and a glass theme." Foreground="#D6C8DF" FontSize="16" Margin="2,6,0,0"/>

        <StackPanel x:Name="Body" Grid.Row="2" VerticalAlignment="Center" Margin="2,0,0,0">
          <TextBlock x:Name="Headline" Text="Checking for the latest build" FontSize="22" Foreground="White" FontWeight="SemiBold" FontFamily="Segoe UI Variable Display, Segoe UI"/>
          <TextBlock x:Name="Detail" Text="One moment." Foreground="#C9B8D4" FontSize="14.5" Margin="0,8,0,0" TextWrapping="Wrap" MaxWidth="600" HorizontalAlignment="Left" LineHeight="21"/>
          <StackPanel x:Name="ChannelRow" Orientation="Horizontal" Margin="0,16,0,0" Visibility="Collapsed"/>
          <Grid x:Name="BarRow" Margin="0,22,0,0" Height="6" Width="600" HorizontalAlignment="Left" Visibility="Collapsed">
            <Border CornerRadius="3" Background="#30FFFFFF"/>
            <Border x:Name="Bar" CornerRadius="3" Background="#FF5FAE" HorizontalAlignment="Left" Width="0"/>
          </Grid>
        </StackPanel>

        <Grid Grid.Row="3">
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Left">
            <Button x:Name="MainButton" Style="{StaticResource Primary}" Content="Install" IsEnabled="False" MinWidth="150"/>
            <Button x:Name="RemoveButton" Style="{StaticResource Quiet}" Content="Uninstall" Margin="10,0,0,0" Visibility="Collapsed"/>
          </StackPanel>
          <TextBlock x:Name="Foot" HorizontalAlignment="Right" VerticalAlignment="Center" Foreground="#9F8FAA" FontSize="12.5" Text=""/>
        </Grid>
      </Grid>
    </Grid>
  </Border>
</Window>
'@

$Window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $Xaml))
$UI = @{}
foreach ($name in 'Shell', 'CloseButton', 'Logo', 'LogoLine', 'LogoFill', 'Body', 'Headline', 'Detail', 'ChannelRow', 'BarRow', 'Bar', 'MainButton', 'RemoveButton', 'Foot') {
    $UI[$name] = $Window.FindName($name)
}

# The wordmark: "glass" as a bare outline, "house" solid.
function New-WordGeometry([string]$Text, [double]$X) {
    $family = New-Object Windows.Media.FontFamily 'Segoe UI Variable Display, Segoe UI'
    $face = New-Object Windows.Media.Typeface $family, ([Windows.FontStyles]::Normal), ([Windows.FontWeights]::Bold), ([Windows.FontStretches]::Normal)
    $formatted = New-Object Windows.Media.FormattedText $Text, ([Globalization.CultureInfo]::InvariantCulture), ([Windows.FlowDirection]::LeftToRight), $face, 82, ([Windows.Media.Brushes]::White)
    @{ Geometry = $formatted.BuildGeometry((New-Object Windows.Point $X, -14)); Width = $formatted.WidthIncludingTrailingWhitespace }
}
$glass = New-WordGeometry 'glass' 0
$house = New-WordGeometry 'house' ($glass.Width + 2)
$UI.LogoLine.Data = $glass.Geometry
$UI.LogoFill.Data = $house.Geometry
$UI.Logo.Width = $glass.Width + $house.Width + 4

# ---------------------------------------------------------------- helpers

# Lets the window repaint and respond while a long step is running.
function Pump {
    $frame = New-Object Windows.Threading.DispatcherFrame
    $callback = [Windows.Threading.DispatcherOperationCallback] { param($f) $f.Continue = $false; $null }
    [void][Windows.Threading.Dispatcher]::CurrentDispatcher.BeginInvoke([Windows.Threading.DispatcherPriority]::Background, $callback, $frame)
    [Windows.Threading.Dispatcher]::PushFrame($frame)
}

function Wait-Task($Task) {
    while (-not $Task.IsCompleted) { Pump; Start-Sleep -Milliseconds 15 }
    if ($Task.IsFaulted) { throw $Task.Exception.GetBaseException() }
}

function New-Client {
    $client = New-Object Net.WebClient
    $client.Headers['User-Agent'] = 'Glasshouse-Setup'
    $client.Encoding = [Text.Encoding]::UTF8
    $client
}

function Get-RemoteText([string]$Url) {
    $client = New-Client
    try { $task = $client.DownloadStringTaskAsync($Url); Wait-Task $task; $task.Result } finally { $client.Dispose() }
}

function Get-RemoteFile([string]$Url, [string]$Path) {
    $client = New-Client
    try { Wait-Task ($client.DownloadFileTaskAsync($Url, $Path)) } finally { $client.Dispose() }
}

function Set-Text([string]$Headline, [string]$Detail) {
    $UI.Headline.Text = $Headline
    $UI.Detail.Text = $Detail
    $fade = New-Object Windows.Media.Animation.DoubleAnimation 0.35, 1, (New-Object Windows.Duration ([TimeSpan]::FromMilliseconds(260)))
    $UI.Body.BeginAnimation([Windows.UIElement]::OpacityProperty, $fade)
    Pump
}

function Set-Progress([double]$Fraction) {
    $UI.BarRow.Visibility = 'Visible'
    $slide = New-Object Windows.Media.Animation.DoubleAnimation (600 * $Fraction), (New-Object Windows.Duration ([TimeSpan]::FromMilliseconds(420)))
    $slide.EasingFunction = New-Object Windows.Media.Animation.CubicEase
    $UI.Bar.BeginAnimation([Windows.FrameworkElement]::WidthProperty, $slide)
    Pump
}

function Get-Chosen {
    if ($Channels.Count -le 1) { return @($Channels) }
    @($UI.ChannelRow.Children | Where-Object { $_.IsChecked } | ForEach-Object { $_.Tag })
}

function Stop-Discord($Chosen) {
    foreach ($channel in $Chosen) {
        Get-Process -Name $channel.Folder -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 60; $i++) {
        $left = $Chosen | Where-Object { Get-Process -Name $_.Folder -ErrorAction SilentlyContinue }
        if (-not $left) { break }
        Pump; Start-Sleep -Milliseconds 100
    }
    Start-Sleep -Milliseconds 400
}

function Start-Discord($Chosen) {
    foreach ($channel in $Chosen) {
        $update = Join-Path $env:LOCALAPPDATA (Join-Path $channel.Folder 'Update.exe')
        Start-Process -FilePath $update -ArgumentList '--processStart', "$($channel.Folder).exe"
    }
}

# Runs Vencord's own installer against one Discord, pointed at our folder.
function Invoke-Patcher($Channel, [string]$Action) {
    $exe = Join-Path $Tools 'VencordInstallerCli.exe'
    $log = Join-Path $Root "patcher-$($Channel.Branch).log"
    $env:VENCORD_USER_DATA_DIR = $Root
    $env:VENCORD_DEV_INSTALL = '1'
    $process = Start-Process -FilePath $exe -ArgumentList $Action, '-branch', $Channel.Branch -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    # Without holding the handle, PowerShell cannot read the exit code of a process it did not wait for.
    $handle = $process.Handle
    while (-not $process.HasExited) { Pump; Start-Sleep -Milliseconds 50 }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Vencord's installer could not patch $($Channel.Name) (code $($process.ExitCode)). Details are in $log.err"
    }
}

function Set-Member($Object, [string]$Name, $Value) {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

# Turns the plugin, its helper plugin and the theme on in Vencord's settings file.
# Returns $false, leaving the file alone, when the existing file cannot be read.
function Enable-Glasshouse([string]$File) {
    $settings = $null
    if (Test-Path $File) {
        Copy-Item $File "$File.before-glasshouse" -Force
        try { $settings = [IO.File]::ReadAllText($File) | ConvertFrom-Json } catch { return $false }
        if ($settings -isnot [pscustomobject]) { return $false }
    } else {
        [void](New-Item -ItemType Directory -Force (Split-Path $File))
        $settings = [pscustomobject]@{}
    }
    if ($settings.plugins -isnot [pscustomobject]) { Set-Member $settings 'plugins' ([pscustomobject]@{}) }
    foreach ($plugin in 'Glasshouse', 'ThemeAttributes') {
        if ($settings.plugins.$plugin -isnot [pscustomobject]) { Set-Member $settings.plugins $plugin ([pscustomobject]@{}) }
        Set-Member $settings.plugins.$plugin 'enabled' $true
    }
    $themes = @($settings.enabledThemes | Where-Object { $_ })
    if ($themes -notcontains $ThemeFile) { $themes += $ThemeFile }
    Set-Member $settings 'enabledThemes' ([object[]]$themes)
    Set-Member $settings 'autoUpdate' $true
    [IO.File]::WriteAllText($File, ($settings | ConvertTo-Json -Depth 64), (New-Object Text.UTF8Encoding $false))
    $true
}

# ---------------------------------------------------------------- screens

function Show-Home {
    $S.Busy = $false
    $UI.BarRow.Visibility = 'Collapsed'
    $UI.MainButton.IsEnabled = $true
    $UI.ChannelRow.Visibility = if ($Channels.Count -gt 1) { 'Visible' } else { 'Collapsed' }
    $UI.Foot.Text = "Build $($S.Latest.Hash)"
    if (-not $S.Installed) {
        $UI.MainButton.Content = 'Install'
        $UI.RemoveButton.Visibility = 'Collapsed'
        Set-Text 'Ready to install' 'Discord closes for a moment while it is patched, then opens again with Glasshouse on. Your Vencord settings and plugins are kept.'
    } elseif ($S.Installed.hash -ne $S.Latest.Hash) {
        $UI.MainButton.Content = 'Update'
        $UI.RemoveButton.Visibility = 'Visible'
        Set-Text 'An update is ready' "You have build $($S.Installed.hash). Discord also updates Glasshouse by itself, so this is only needed if that did not happen."
    } else {
        $UI.MainButton.Content = 'Reinstall'
        $UI.RemoveButton.Visibility = 'Visible'
        Set-Text 'Glasshouse is installed and up to date' 'Reinstall if Discord stopped loading it, for example after a big Discord update.'
    }
}

function Show-Problem([string]$Message) {
    $S.Busy = $false
    $UI.BarRow.Visibility = 'Collapsed'
    $UI.MainButton.Content = 'Try again'
    $UI.MainButton.IsEnabled = $true
    Set-Text 'That did not work' $Message
}

function Find-Latest {
    $UI.MainButton.IsEnabled = $false
    Set-Text 'Checking for the latest build' 'One moment.'
    try {
        $release = Get-RemoteText "https://api.github.com/repos/$Repo/releases/latest" | ConvertFrom-Json
        $files = @{}
        foreach ($asset in $release.assets) { $files[$asset.name] = $asset.browser_download_url }
        foreach ($needed in ($BuildFiles + $ThemeFile)) {
            if (-not $files.ContainsKey($needed)) { throw "The latest release is missing $needed." }
        }
        $S.Latest = @{ Hash = $release.name.Substring($release.name.LastIndexOf(' ') + 1); Files = $files }
    } catch {
        return Show-Problem "Could not get the latest build from GitHub. Check your internet connection. ($($_.Exception.Message))"
    }
    $S.Installed = $null
    if ((Test-Path $Stamp) -and (Test-Path (Join-Path $Dist 'patcher.js'))) {
        try { $S.Installed = [IO.File]::ReadAllText($Stamp) | ConvertFrom-Json } catch { }
    }
    if (-not $Channels) {
        $UI.MainButton.Content = 'Check again'
        $UI.MainButton.IsEnabled = $true
        return Set-Text 'Discord is not installed' 'Install the Discord desktop app from discord.com first, open it once, then check again.'
    }
    Show-Home
}

function Install-Glasshouse {
    $chosen = Get-Chosen
    if (-not $chosen) { return Set-Text 'Pick a Discord' 'Choose at least one of the Discord apps below.' }
    $S.Busy = $true
    $UI.MainButton.IsEnabled = $false
    $UI.RemoveButton.Visibility = 'Collapsed'
    $UI.ChannelRow.Visibility = 'Collapsed'
    try {
        Set-Text 'Downloading Glasshouse' "Build $($S.Latest.Hash) from github.com/$Repo."
        Set-Progress 0.06
        $incoming = Join-Path $Root 'incoming'
        [void](New-Item -ItemType Directory -Force $incoming, $Tools, $Dist)
        $names = $BuildFiles + $ThemeFile
        for ($i = 0; $i -lt $names.Count; $i++) {
            Get-RemoteFile $S.Latest.Files[$names[$i]] (Join-Path $incoming $names[$i])
            Set-Progress (0.06 + 0.4 * ($i + 1) / $names.Count)
        }

        Set-Text 'Getting the patcher' "Vencord's own installer does the patching. It is downloaded from github.com/Vencord/Installer."
        Get-RemoteFile $PatcherUrl (Join-Path $Tools 'VencordInstallerCli.exe')
        Set-Progress 0.6

        if ($DryRun) {
            Set-Progress 1
            return Set-Text 'Test run finished' "Everything downloaded to $incoming. Nothing was changed."
        }

        Set-Text 'Closing Discord' 'It opens again in a moment.'
        Stop-Discord $chosen
        Set-Progress 0.68

        Set-Text 'Patching Discord' 'Pointing Discord at the Glasshouse build.'
        foreach ($name in $BuildFiles) { Move-Item (Join-Path $incoming $name) (Join-Path $Dist $name) -Force }
        foreach ($channel in $chosen) { Invoke-Patcher $channel '-install' }
        Set-Progress 0.84

        Set-Text 'Turning Glasshouse on' 'Enabling the plugin and the theme in your Vencord settings.'
        $themes = Join-Path $VencordData 'themes'
        [void](New-Item -ItemType Directory -Force $themes)
        Move-Item (Join-Path $incoming $ThemeFile) (Join-Path $themes $ThemeFile) -Force
        Remove-Item $incoming -Recurse -Force -ErrorAction SilentlyContinue
        $enabled = Enable-Glasshouse (Join-Path $VencordData 'settings\settings.json')
        $record = @{ hash = $S.Latest.Hash; branches = @($chosen | ForEach-Object { $_.Branch }) } | ConvertTo-Json
        [IO.File]::WriteAllText($Stamp, $record)
        Set-Progress 0.94

        Set-Text 'Starting Discord' 'Almost there.'
        Start-Discord $chosen
        Set-Progress 1

        $S.Done = $true
        $UI.MainButton.Content = 'Done'
        $UI.MainButton.IsEnabled = $true
        if ($enabled) {
            Set-Text 'You are in' 'Discord is opening with Glasshouse on. From now on it updates by itself: Discord shows a notice when a new build has been installed.'
        } else {
            Set-Text 'Installed, with one step left' 'Your Vencord settings file could not be read, so it was left alone. In Discord, open Settings, then Vencord: turn on the Glasshouse and ThemeAttributes plugins, and the Glasshouse theme.'
        }
    } catch {
        # Discord was closed for the patch; bring it back so a failure does not leave it shut.
        try { Start-Discord $chosen } catch { }
        Show-Problem $_.Exception.Message
    }
}

function Uninstall-Glasshouse {
    $chosen = @($Channels | Where-Object { @($S.Installed.branches) -contains $_.Branch })
    if (-not $chosen) { $chosen = @($Channels) }
    $S.Busy = $true
    $UI.MainButton.IsEnabled = $false
    $UI.RemoveButton.Visibility = 'Collapsed'
    $UI.ChannelRow.Visibility = 'Collapsed'
    try {
        Set-Text 'Closing Discord' 'It opens again in a moment.'
        Set-Progress 0.2
        Stop-Discord $chosen
        Set-Text 'Removing the patch' 'Discord goes back to how it was before Vencord.'
        if (-not (Test-Path (Join-Path $Tools 'VencordInstallerCli.exe'))) {
            [void](New-Item -ItemType Directory -Force $Tools)
            Get-RemoteFile $PatcherUrl (Join-Path $Tools 'VencordInstallerCli.exe')
        }
        foreach ($channel in $chosen) { Invoke-Patcher $channel '-uninstall' }
        Set-Progress 0.7
        Remove-Item $Dist, $Stamp -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $VencordData "themes\$ThemeFile") -Force -ErrorAction SilentlyContinue
        Start-Discord $chosen
        Set-Progress 1
        $S.Done = $true
        $S.Installed = $null
        $UI.MainButton.Content = 'Done'
        $UI.MainButton.IsEnabled = $true
        Set-Text 'Glasshouse is removed' 'Discord is opening without it. Your Vencord settings were kept in case you come back.'
    } catch {
        Show-Problem $_.Exception.Message
    }
}

# ---------------------------------------------------------------- wiring

foreach ($channel in $Channels) {
    $toggle = New-Object Windows.Controls.Primitives.ToggleButton
    $toggle.Style = $Window.FindResource('Channel')
    $toggle.Content = $channel.Name
    $toggle.Tag = $channel
    $toggle.IsChecked = ($channel.Branch -eq $Channels[0].Branch)
    [void]$UI.ChannelRow.Children.Add($toggle)
}

$UI.Shell.Add_MouseLeftButtonDown({ try { $Window.DragMove() } catch { } })
$UI.CloseButton.Add_Click({ if (-not $S.Busy) { $Window.Close() } })
$UI.RemoveButton.Add_Click({ if (-not $S.Busy) { Uninstall-Glasshouse } })
$UI.MainButton.Add_Click({
    if ($S.Busy) { return }
    if ($S.Done) { return $Window.Close() }
    if (-not $S.Latest -or -not $Channels) { return Find-Latest }
    Install-Glasshouse
})
$Window.Add_Closing({ param($source, $event) if ($S.Busy) { $event.Cancel = $true } })
$Window.Add_ContentRendered({ if (-not $S.Latest) { Find-Latest } })

if ($Snapshot) {
    # Draw the window into a picture without showing it.
    $S.Latest = @{ Hash = 'a1b2c3d'; Files = @{} }
    if ($env:GH_SNAPSHOT_STATE -eq 'working') {
        $UI.Headline.Text = 'Patching Discord'; $UI.Detail.Text = 'Pointing Discord at the Glasshouse build.'
        $UI.BarRow.Visibility = 'Visible'; $UI.Bar.Width = 420; $UI.Foot.Text = 'Build a1b2c3d'
    } else {
        $UI.Headline.Text = 'Ready to install'
        $UI.Detail.Text = 'Discord closes for a moment while it is patched, then opens again with Glasshouse on. Your Vencord settings and plugins are kept.'
        $UI.MainButton.IsEnabled = $true; $UI.Foot.Text = 'Build a1b2c3d'
        if ($UI.ChannelRow.Children.Count -gt 1) { $UI.ChannelRow.Visibility = 'Visible' }
    }
    $shell = $Window.Content
    $Window.Content = $null
    $size = New-Object Windows.Size 780, 500
    $shell.Measure($size)
    $shell.Arrange((New-Object Windows.Rect $size))
    $shell.UpdateLayout()
    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap 1560, 1000, 192, 192, ([Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($shell)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create($Snapshot)
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
    return
}

[void]$Window.ShowDialog()
