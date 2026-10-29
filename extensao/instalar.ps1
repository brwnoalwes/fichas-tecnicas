# Instala (ou atualiza) a extensão "Separacao Estamparia" no Photoshop 2020+ deste usuário.
# Uso, na pasta do projeto:  powershell -ExecutionPolicy Bypass -File extensao\instalar.ps1
# Depois feche e abra o Photoshop: Janela > Extensões > Separacao Estamparia.

$ErrorActionPreference = "Stop"
$origem = $PSScriptRoot
$motor = Join-Path (Split-Path $origem -Parent) "motor\separacao.js"
$destino = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.estamparia.separacao"

# extensões sem assinatura precisam do modo de depuração do CEP (Photoshop 2020 = CSXS.9)
foreach ($v in 9..12) {
    $k = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
    if ((Get-ItemProperty $k -ErrorAction SilentlyContinue).PlayerDebugMode -ne "1") {
        Set-ItemProperty -Path $k -Name PlayerDebugMode -Value "1"
        Write-Host "PlayerDebugMode ligado em CSXS.$v"
    }
}

if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
New-Item -ItemType Directory -Path $destino | Out-Null
Copy-Item (Join-Path $origem "*") $destino -Recurse -Force -Exclude "instalar.ps1"
Copy-Item (Join-Path $origem ".debug") $destino -Force
Copy-Item $motor (Join-Path $destino "js\motor.js") -Force
Write-Host "Instalado em $destino"
Write-Host "Feche e abra o Photoshop: Janela > Extensoes > Separacao Estamparia"
