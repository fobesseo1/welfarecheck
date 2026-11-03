@echo off
rem Run every morning by Windows Task Scheduler (task name: MosimDuo-FacilityCollect).
rem Resumes the long-term care facility detail download up to the daily API limit,
rem then rebuilds web/public/facilities. Deletes its own scheduled task when nothing is left.
rem Keep this file ASCII only (cmd.exe misreads UTF-8). Log: data\facilities\raw\daily.log
cd /d "%~dp0..\.."
set NODE="C:\Program Files\nodejs\node.exe"
set LOG=data\facilities\raw\daily.log

echo ===== %date% %time% start >> %LOG%
rem --days 365: never re-download facilities already fetched (goal = one full national pass)
%NODE% tools\facilities\collect.mjs detail --max 9000 --days 365 >> %LOG% 2>&1
rem coordinates for facilities whose address is new or changed (needs JUSO_COORD_API_KEY)
%NODE% tools\facilities\collect.mjs geo >> %LOG% 2>&1
rem main path: epost address DB (data\facilities\raw\epost) -> text address -> VWorld geocoder (VWORLD_API_KEY)
%NODE% tools\facilities\collect.mjs geo-addr >> %LOG% 2>&1
%NODE% tools\facilities\collect.mjs build >> %LOG% 2>&1

%NODE% -e "process.exit(require('./data/facilities/raw/detail-status.json').remaining === 0 ? 0 : 1)"
if %errorlevel%==0 (
  echo all facilities fetched - deleting scheduled task >> %LOG%
  schtasks /Delete /TN "MosimDuo-FacilityCollect" /F >> %LOG% 2>&1
)
echo ===== %date% %time% end >> %LOG%
