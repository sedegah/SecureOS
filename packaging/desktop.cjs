const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

(async () => {
  const repo = path.resolve(__dirname, '..');
  const destination = path.join(repo, 'build/desktop/Surge-win32-x64');
  if (fs.existsSync(path.join(destination, 'Data')) || fs.existsSync(path.join(destination, 'Downloads')))
    throw new Error('The package contains user data. Move the existing package aside before rebuilding.');
  const publish = spawnSync('dotnet', ['publish', path.join(repo, 'launcher/SurgeLauncher.csproj'), '-c', 'Release', '-o', path.join(repo, 'build/publish'), '--nologo'], { stdio: 'inherit' });
  if (publish.status !== 0) throw new Error('The storage helper could not be built.');
  const helperDirectory = path.join(repo, 'build/desktop-resources/helper');
  fs.mkdirSync(helperDirectory, { recursive: true });
  fs.copyFileSync(path.join(repo, 'build/publish/Surge.exe'), path.join(helperDirectory, 'Surge.exe'));
  const { packager } = await import(pathToModule('desktop/node_modules/@electron/packager/dist/index.js'));
  const outputs = await packager({
    dir: path.join(repo, 'desktop'), name: 'Surge', executableName: 'Surge',
    platform: 'win32', arch: 'x64', out: path.join(repo, 'build/desktop'),
    asar: true, prune: true, overwrite: true,
    extraResource: [path.join(repo, 'build/desktop-resources/helper')],
    appCopyright: 'Surge',
    icon: path.join(repo, 'desktop/assets/icon.ico'),
    win32metadata: { ProductName: 'Surge', FileDescription: 'Surge workspace and browser' },
  });
  for (const output of outputs) {
    fs.cpSync(path.join(repo, 'interface'), path.join(output, 'Interface'), { recursive: true });
    fs.cpSync(path.join(repo, 'LICENSES'), path.join(output, 'Licenses'), { recursive: true });
    fs.writeFileSync(path.join(output, 'README.txt'), 'SURGE\r\n\r\nOpen Surge.exe to start your workspace. Select Surge Browser to browse the web.\r\nKeep this entire folder together on your USB drive. Your data stays in Data and Downloads.\r\nClose Surge before safely ejecting the drive. Keep a separate backup of your data.\r\nThis is a Windows application, not a bootable operating-system image.\r\n');
    console.log('Standalone Surge package:', output);
  }
  function pathToModule(relative) { return require('node:url').pathToFileURL(path.join(repo, relative)).href; }
})().catch(error => { console.error(error); process.exitCode = 1; });
