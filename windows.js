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

// needed for 1.9.3, 2.0, 2.1, 2.2, 2.3, and mswin, cert file used by Git for Windows
const certFile = 'C:\\Program Files\\Git\\mingw64\\ssl\\cert.pem'

// location & path for old RubyInstaller DevKit (MSYS), Ruby 1.9.3, 2.0, 2.1, 2.2 and 2.3
const msysX64 = `${drive}:\\DevKit64`
const msysX86 = `${drive}:\\DevKit`
const msysPathEntriesX64 = [`${msysX64}\\mingw\\x86_64-w64-mingw32\\bin`, `${msysX64}\\mingw\\bin`, `${msysX64}\\bin`]
const msysPathEntriesX86 = [`${msysX86}\\mingw\\i686-w64-mingw32\\bin`, `${msysX86}\\mingw\\bin`, `${msysX86}\\bin`]

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

  common.setupPath([`${rubyPrefix}\\bin`, ...toolchainPaths])

  if (!inToolCache) {
    await downloadAndExtract(engine, version, url, base, rubyPrefix);
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

async function downloadAndExtract(engine, version, url, base, rubyPrefix) {
  const parentDir = path.dirname(rubyPrefix)

  const downloadPath = await common.measure('Downloading Ruby', async () => {
    console.log(url)
    return await tc.downloadTool(url)
  })

  await common.measure('Extracting Ruby', async () =>
    exec.exec('7z', ['x', downloadPath, `-xr!${base}\\share\\doc`, `-o${parentDir}`], { silent: true }))

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

  // All standard MSVC OpenSSL builds use C:\Program Files\Common Files\SSL
  const certsDir = 'C:\\Program Files\\Common Files\\SSL\\certs'
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir)
  }

  // cert.pem location is hard-coded by OpenSSL msvc builds
  const cert = 'C:\\Program Files\\Common Files\\SSL\\cert.pem'
  if (!fs.existsSync(cert)) {
    fs.copyFileSync(certFile, cert)
  }

  return await common.measure('Setting up MSVC environment', async () => addVCVARSEnv())
}

/* Sets MSVC environment for use in Actions
 *   allows steps to run without running vcvars*.bat, also for PowerShell
 *   adds a convenience VCVARS environment variable
 *   this assumes a single Visual Studio version being available in the windows-latest image */
export function addVCVARSEnv() {
  const vcVars = '"C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat"'
  core.exportVariable('VCVARS', vcVars)

  let newEnv = new Map()
  let cmd = `cmd.exe /c "${vcVars} && set"`
  let newSet = cp.execSync(cmd).toString().trim().split(/\r?\n/)
  newSet = newSet.filter(line => line.match(/\S=\S/))
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
