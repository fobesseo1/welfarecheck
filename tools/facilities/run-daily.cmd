@echo off
rem Run every morning by Windows Task Scheduler (task name: MosimDuo-FacilityCollect).
rem Refreshes the facility list, re-downloads details older than 14 days up to the daily API limit,
rem then rebuilds web/public/facilities. Days with nothing due finish quickly with no commit.
rem Keep this file ASCII only (cmd.exe misreads UTF-8). Log: data\facilities\raw\daily.log
cd /d "%~dp0..\.."
set NODE="C:\Program Files\nodejs\node.exe"
set LOG=data\facilities\raw\daily.log

echo ===== %date% %time% start >> %LOG%
rem new and closed facilities; on a partial download the previous list is kept
%NODE% tools\facilities\collect.mjs list >> %LOG% 2>&1
rem --days 14: refresh every facility about every two weeks; a pass over 30,000 needs about 4 days of quota
%NODE% tools\facilities\collect.mjs detail --max 9000 --days 14 >> %LOG% 2>&1
rem coordinates for facilities whose address is new or changed (needs JUSO_COORD_API_KEY)
%NODE% tools\facilities\collect.mjs geo >> %LOG% 2>&1
rem main path: epost address DB (data\facilities\raw\epost) -> text address -> VWorld geocoder (VWORLD_API_KEY)
%NODE% tools\facilities\collect.mjs geo-addr >> %LOG% 2>&1
%NODE% tools\facilities\collect.mjs build >> %LOG% 2>&1

rem publish: commit only web/public/facilities and push -> Vercel redeploys the site
git diff --quiet -- web/public/facilities
set CHANGED=%errorlevel%
git ls-files --others --exclude-standard -- web/public/facilities | findstr . >nul && set CHANGED=1
if not "%CHANGED%"=="0" (
  git add -- web/public/facilities >> %LOG% 2>&1
  git commit -m "facility data daily update %date%" --only -- web/public/facilities >> %LOG% 2>&1
  git pull --rebase --autostash origin main >> %LOG% 2>&1
  git push origin main >> %LOG% 2>&1
  echo published facility data >> %LOG%
) else (
  echo no facility data change >> %LOG%
)

echo ===== %date% %time% end >> %LOG%
