@echo off
cd /d "%~dp0"
echo Envoi des modifications vers GitHub...
git add -A
git commit -m "Mise a jour du %date% a %time%"
git push
echo.
echo Termine ! Le site va se mettre a jour dans une a deux minutes :
echo https://jelauchri-blip.github.io/LadyQueen/
echo.
pause
