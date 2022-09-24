// Most of this logic is from
// https://github.com/MSP-Greg/actions-ruby/blob/master/lib/main.js

const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const core = require('@actions/core')
const exec = require('@actions/exec')
const io = require('@actions/io')
const tc = require('@actions/tool-cache')
const common = require('./common')
const rubyInstallerVersions = require('./windows-versions').versions

const drive = common.drive

const msys2GCCReleaseURI  = 'https://github.com/ruby/setup-msys2-gcc/releases/download'

const msys2BasePath = process.env['GHCUP_MSYS2']
const vcPkgBasePath = process.env['VCPKG_INSTALLATION_ROOT']

// needed for 1.9.3, 2.0, 2.1, 2.2, 2.3, and mswin, cert file used by Git for Windows
const certFile = 'C:\\Program Files\\Git\\mingw64\\ssl\\cert.pem'

// location & path for old RubyInstaller DevKit (MSYS), Ruby 1.9.3, 2.0, 2.1, 2.2 and 2.3
const msysX64 = `${drive}:\\DevKit64`
const msysX86 = `${drive}:\\DevKit`
const msysPathEntriesX64 = [`${msysX64}\\mingw\\x86_64-w64-mingw32\\bin`, `${msysX64}\\mingw\\bin`, `${msysX64}\\bin`]
const msysPathEntriesX86 = [`${msysX86}\\mingw\\i686-w64-mingw32\\bin`, `${msysX86}\\mingw\\bin`, `${msysX86}\\bin`]

const virtualEnv = common.getVirtualEnvironmentName()

export function getAvailableVersions(platform, engine, architecture) {
  if (engine === 'ruby') {
    if (architecture === 'default') {
      let versions = new Set([...Object.keys(rubyInstallerVersions['x64']), ...Object.keys(rubyInstallerVersions['x86'])])
      versions = [...versions];
      versions.sort((v1, v2) => {
        v1 = v1.split('.').map(v => parseInt(v, 10))
        v2 = v2.split('.').map(v => parseInt(v, 10))
        const len = Math.min(v1.length, v2.length)
        for (let i = 0; i < len; i++) {
          const diff = v1[i] - v2[i]
          if (diff != 0) return diff
        }

        if (v1.length > len) return -1;
        if (v2.length > len) return 1;
        return 0;
      })
      return versions;
    }
    return Object.keys(rubyInstallerVersions[architecture])
  } else {
    return undefined
  }
}

export async function install(platform, engine, architecture, version) {
  const selectedArch = getArchitecture(architecture, version)
  if (!selectedArch) throw new Error(`Version '${version}' not found for architecture '${architecture}'`)
  const url = rubyInstallerVersions[selectedArch][version]

  // The windows-2016 and windows-2019 images have MSYS2 build tools (C:/msys64/usr)
  // and MinGW build tools installed.  The windows-2022 image has neither.
  const hasMSYS2PreInstalled = ['windows-2019', 'windows-2016'].includes(virtualEnv)

  if (!url.endsWith('.7z')) {
    throw new Error(`URL should end in .7z: ${url}`)
  }
  const base = url.slice(url.lastIndexOf('/') + 1, url.length - '.7z'.length)

  let rubyPrefix, inToolCache
  if (common.shouldUseToolCache(engine, version)) {
    inToolCache = architecture === 'x64' && tc.find('Ruby', version)
    if (inToolCache) {
      rubyPrefix = inToolCache
    } else {
      rubyPrefix = common.getToolCacheRubyPrefix(platform, selectedArch, version)
    }
  } else {
    rubyPrefix = `${drive}:\\${base}`
  }

  let toolchainPaths = (version === 'mswin') ? await setupMSWin() : await setupMingw(selectedArch, version)

  if (!inToolCache) {
    await downloadAndExtract(engine, version, url, base, rubyPrefix);
  }

  const msys2Type = common.setupPath([`${rubyPrefix}\\bin`, ...toolchainPaths])

  if (!hasMSYS2PreInstalled) {
    await installMSYS2Tools()
  }

  if (version === 'mswin') {
    await installVCPkg()
  }

  const ridk = `${rubyPrefix}\\bin\\ridk.cmd`
  if (fs.existsSync(ridk)) {
    await common.measure('Adding ridk env variables', async () => addRidkEnv(ridk))
  }

  return rubyPrefix
}

function getArchitecture(architecture, version) {
  if (architecture === 'default') {
    if (rubyInstallerVersions['x64'][version]) {
      console.log(`Using x64 version of ${version}`)
      return 'x64'
    }

    if (rubyInstallerVersions['x86'][version]) {
      console.log(`Using x86 version of ${version}`)
      return 'x86'
    }

    return null
  }

  if (rubyInstallerVersions[architecture][version]) {
    console.log(`Using ${architecture} version of ${version}`)
    return architecture
  }

  return null
}

// Actions windows-2022 image does not contain any mingw or ucrt build tools.  Install tools for it,
// and also install ucrt tools on earlier versions, which have msys2 and mingw tools preinstalled.
async function installGCCTools(type) {
  const downloadPath = await common.measure(`Downloading ${type} build tools`, async () => {
    let url = `${msys2GCCReleaseURI}/msys2-gcc-pkgs/${type}.7z`
    console.log(url)
    return await tc.downloadTool(url)
  })

  await common.measure(`Extracting  ${type} build tools`, async () =>
    exec.exec('7z', ['x', downloadPath, '-aoa', '-bd', `-o${msys2BasePath}`], { silent: true }))
}

// Actions windows-2022 image does not contain any MSYS2 build tools.  Install tools for it.
// A subset of the MSYS2 base-devel group
async function installMSYS2Tools() {
  const downloadPath = await common.measure(`Downloading msys2 build tools`, async () => {
    let url = `${msys2GCCReleaseURI}/msys2-gcc-pkgs/msys2.7z`
    console.log(url)
    return await tc.downloadTool(url)
  })

  // need to remove all directories, since they may indicate old packages are installed,
  // otherwise, error of "error: duplicated database entry"
  fs.rmSync(`${msys2BasePath}\\var\\lib\\pacman\\local`, { recursive: true, force: true })

  await common.measure(`Extracting  msys2 build tools`, async () =>
    exec.exec('7z', ['x', downloadPath, '-aoa', '-bd', `-o${msys2BasePath}`], { silent: true }))
}

// Windows JRuby can install gems that require compile tools, only needed for
// windows-2022 and later images
export async function installJRubyTools() {
  await installMSYS2Tools()
  await installGCCTools('mingw64')
}

// Install vcpkg files needed to build mswin Ruby
async function installVCPkg() {
  const downloadPath = await common.measure(`Downloading mswin vcpkg packages`, async () => {
    let url = `${msys2GCCReleaseURI}/msys2-gcc-pkgs/mswin.7z`
    console.log(url)
    return await tc.downloadTool(url)
  })

  await common.measure(`Extracting  mswin vcpkg packages`, async () =>
    exec.exec('7z', ['x', downloadPath, '-aoa', '-bd', `-o${vcPkgBasePath}`], { silent: true }))
}

async function downloadAndExtract(engine, version, url, base, rubyPrefix) {
  const parentDir = path.dirname(rubyPrefix)

  const downloadPath = await common.measure('Downloading Ruby', async () => {
    console.log(url)
    return await tc.downloadTool(url)
  })

  await common.measure('Extracting Ruby', async () =>
    exec.exec('7z', ['x', downloadPath, '-bd', `-xr!${base}\\share\\doc`, `-o${parentDir}`], { silent: true }))

  if (base !== path.basename(rubyPrefix)) {
    await io.mv(path.join(parentDir, base), rubyPrefix)
  }

  if (common.shouldUseToolCache(engine, version)) {
    common.createToolCacheCompleteFile(rubyPrefix)
  }
}

async function setupMingw(architecture, version) {
  core.exportVariable('MAKE', 'make.exe')

  if (version.match(/^(1\.|2\.[0123])/)) {
    renameSystem32Dlls()
    core.exportVariable('SSL_CERT_FILE', certFile)
    await common.measure('Installing MSYS', async () => installMSYS(architecture, version))
    return architecture === 'x86' ? msysPathEntriesX86 : msysPathEntriesX64
  } else {
    return []
  }
}

// Ruby 1.9.3, 2.0, 2.1, 2.2 and 2.3
async function installMSYS(architecture, version) {
  const url = architecture === 'x86'
    ? 'https://github.com/oneclick/rubyinstaller/releases/download/devkit-4.7.2/DevKit-mingw64-32-4.7.2-20130224-1151-sfx.exe'
    : 'https://github.com/oneclick/rubyinstaller/releases/download/devkit-4.7.2/DevKit-mingw64-64-4.7.2-20130224-1432-sfx.exe'
  const downloadPath = await tc.downloadTool(url)
  const msys = architecture === 'x86' ? msysX86 : msysX86
  await exec.exec('7z', ['x', downloadPath, `-o${msys}`], { silent: true })

  // below are set in the old devkit.rb file ?
  core.exportVariable('RI_DEVKIT', msys)
  core.exportVariable('CC' , 'gcc')
  core.exportVariable('CXX', 'g++')
  core.exportVariable('CPP', 'cpp')
  core.info(`Installed RubyInstaller DevKit for Ruby ${version}`)
}

async function setupMSWin() {
  core.exportVariable('MAKE', 'nmake.exe')

  // Pre-installed OpenSSL use C:\Program Files\Common Files\SSL
  const certsDir = 'C:\\Program Files\\Common Files\\SSL\\certs'
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true })
  }

  // cert.pem location is hard-coded by OpenSSL msvc builds
  let cert = 'C:\\Program Files\\Common Files\\SSL\\cert.pem'
  if (!fs.existsSync(cert)) {
    fs.copyFileSync(certFile, cert)
  }

    // vcpkg openssl uses packages\openssl_x64-windows\certs
    certsDir = `${vcPkgBasePath}\\packages\\openssl_x64-windows\\certs`
    if (!fs.existsSync(certsDir)) {
      fs.mkdirSync(certsDir, { recursive: true })
    }

    // vcpkg openssl uses packages\openssl_x64-windows\cert.pem
    cert = `${vcPkgBasePath}\\packages\\openssl_x64-windows\\cert.pem`
    fs.copyFileSync(certFile, cert)

  return await common.measure('Setting up MSVC environment', async () => addVCVARSEnv())
}

/* Sets MSVC environment for use in Actions
 *   allows steps to run without running vcvars*.bat, also for PowerShell
 *   adds a convenience VCVARS environment variable
 *   this assumes a single Visual Studio version being available in the Windows images */
export function addVCVARSEnv() {
  let cmd = 'vswhere -latest -property installationPath'
  let vcVars = `${cp.execSync(cmd).toString().trim()}\\VC\\Auxiliary\\Build\\vcvars64.bat`

  if (!fs.existsSync(vcVars)) {
    throw new Error(`Missing vcVars file: ${vcVars}`)
  }
  core.exportVariable('VCVARS', vcVars)

  cmd = `cmd.exe /c ""${vcVars}" && set"`

  let newEnv = new Map()
  let newSet = cp.execSync(cmd).toString().trim().split(/\r?\n/)
  newSet = newSet.filter(line => /\S=\S/.test(line))
  newSet.forEach(s => {
    let [k,v] = common.partition(s, '=')
    newEnv.set(k,v)
  })

  let newPathEntries = undefined
  for (let [k, v] of newEnv) {
    if (process.env[k] !== v) {
      if (/^Path$/i.test(k)) {
        const newPathStr = v.replace(`${path.delimiter}${process.env['Path']}`, '')
        newPathEntries = newPathStr.split(path.delimiter)
      } else {
        core.exportVariable(k, v)
      }
    }
  }
  return newPathEntries
}

// ssl files cause issues with non RI2 Rubies (<2.4) and ruby/ruby's CI from build folder due to dll resolution
function renameSystem32Dlls() {
  const sys32 = 'C:\\Windows\\System32\\'
  const badFiles = [`${sys32}libcrypto-1_1-x64.dll`, `${sys32}libssl-1_1-x64.dll`]
  const existing = badFiles.filter((dll) => fs.existsSync(dll))
  if (existing.length > 0) {
    console.log(`Renaming ${existing.join(' and ')} to avoid dll resolution conflicts on Ruby <= 2.4`)
    existing.forEach(dll => fs.renameSync(dll, `${dll}_`))
  }
}

// Sets MSYS2 ENV variables set from running `ridk enable`
function addRidkEnv(ridk) {
  let newEnv = new Map()
  let cmd = `cmd.exe /c "${ridk} enable && set"`
  let newSet = cp.execSync(cmd).toString().trim().split(/\r?\n/)
  newSet = newSet.filter(line => /^\S+=\S+/.test(line))
  newSet.forEach(s => {
    let [k, v] = common.partition(s, '=')
    newEnv.set(k, v)
  })

  for (let [k, v] of newEnv) {
    if (process.env[k] !== v) {
      if (!/^Path$/i.test(k)) {
        console.log(`${k}=${v}`)
        core.exportVariable(k, v)
      }
    }
  }
}