export const id = 491;
export const ids = [491];
export const modules = {

/***/ 491:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  addVCVARSEnv: () => (/* binding */ addVCVARSEnv),
  getAvailableVersions: () => (/* binding */ getAvailableVersions),
  install: () => (/* binding */ install),
  installJRubyTools: () => (/* binding */ installJRubyTools)
});

// EXTERNAL MODULE: external "node:fs"
var external_node_fs_ = __webpack_require__(3024);
// EXTERNAL MODULE: external "node:path"
var external_node_path_ = __webpack_require__(6760);
// EXTERNAL MODULE: external "node:child_process"
var external_node_child_process_ = __webpack_require__(1421);
// EXTERNAL MODULE: ./node_modules/@actions/core/lib/core.js + 7 modules
var core = __webpack_require__(3838);
// EXTERNAL MODULE: ./node_modules/@actions/exec/lib/exec.js + 2 modules
var exec = __webpack_require__(5260);
// EXTERNAL MODULE: ./node_modules/@actions/io/lib/io.js
var io = __webpack_require__(8701);
// EXTERNAL MODULE: ./node_modules/@actions/tool-cache/lib/tool-cache.js + 2 modules
var tool_cache = __webpack_require__(9805);
// EXTERNAL MODULE: ./common.js
var common = __webpack_require__(9042);
;// CONCATENATED MODULE: ./windows-versions.js
const windows_versions_versions = {
  "x86": {
    "2.0.0": "https://github.com/oneclick/rubyinstaller/releases/download/ruby-2.0.0-p648/ruby-2.0.0-p648-i386-mingw32.7z",
    "1.9.3": "https://github.com/philr/rubyinstaller/releases/download/1.9.3-p551-openssl-tls-1.1-1.2-2/ruby-1.9.3-p551-i386-mingw32.7z"
  },
  "x64": {
    "2.0.0": "https://github.com/oneclick/rubyinstaller/releases/download/ruby-2.0.0-p648/ruby-2.0.0-p648-x64-mingw32.7z"
  }
}

;// CONCATENATED MODULE: ./windows.js
// Most of this logic is from
// https://github.com/MSP-Greg/actions-ruby/blob/master/lib/main.js











const drive = common/* drive */.rU

const msys2GCCReleaseURI  = 'https://github.com/ruby/setup-msys2-gcc/releases/download'

const msys2BasePath = process.env['GHCUP_MSYS2']
const vcPkgBasePath = process.env['VCPKG_INSTALLATION_ROOT']

// needed for 1.9.3, 2.0, 2.1, 2.2, 2.3, and mswin, cert file used by Git for Windows
const certFile = [
  'C:\\Program Files\\Git\\ucrt64\\etc\\ssl\\cert.pem',
  'C:\\Program Files\\Git\\mingw64\\etc\\ssl\\cert.pem',
  'C:\\Program Files\\Git\\mingw64\\ssl\\cert.pem',
].find(file => external_node_fs_.existsSync(file))
if (certFile === undefined) {
  throw new Error("Cannot find Git's cert file")
}

// location & path for old RubyInstaller DevKit (MSYS), Ruby 1.9.3, 2.0, 2.1, 2.2 and 2.3
const msysX64 = `${drive}:\\DevKit64`
const msysX86 = `${drive}:\\DevKit`
const msysPathEntriesX64 = [`${msysX64}\\mingw\\x86_64-w64-mingw32\\bin`, `${msysX64}\\mingw\\bin`, `${msysX64}\\bin`]
const msysPathEntriesX86 = [`${msysX86}\\mingw\\i686-w64-mingw32\\bin`, `${msysX86}\\mingw\\bin`, `${msysX86}\\bin`]

const virtualEnv = common/* getVirtualEnvironmentName */.yk()

function getAvailableVersions(platform, engine, architecture) {
  if (engine === 'ruby') {
    if (architecture === 'default') {
      let versions = new Set([...Object.keys(windows_versions_versions['x64']), ...Object.keys(windows_versions_versions['x86'])])
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
    return Object.keys(windows_versions_versions[architecture])
  } else {
    return undefined
  }
}

async function install(platform, engine, architecture, version) {
  const selectedArch = getArchitecture(architecture, version)
  if (!selectedArch) throw new Error(`Version '${version}' not found for architecture '${architecture}'`)
  const url = windows_versions_versions[selectedArch][version]

  // The windows-2016 and windows-2019 images have MSYS2 build tools (C:/msys64/usr)
  // and MinGW build tools installed.  The windows-2022 image has neither.
  const hasMSYS2PreInstalled = ['windows-2019', 'windows-2016'].includes(virtualEnv)

  if (!url.endsWith('.7z')) {
    throw new Error(`URL should end in .7z: ${url}`)
  }
  const base = url.slice(url.lastIndexOf('/') + 1, url.length - '.7z'.length)

  let rubyPrefix, inToolCache
  if (common/* shouldUseToolCache */.NR(engine, version)) {
    inToolCache = architecture === 'x64' && tool_cache/* find */.I6('Ruby', version)
    if (inToolCache) {
      rubyPrefix = inToolCache
    } else {
      rubyPrefix = common/* getToolCacheRubyPrefix */.X9(platform, selectedArch, version)
    }
  } else {
    rubyPrefix = `${drive}:\\${base}`
  }

  let toolchainPaths = (version === 'mswin') ? await setupMSWin() : await setupMingw(selectedArch, version)

  if (!inToolCache) {
    await downloadAndExtract(engine, version, url, base, rubyPrefix);
  }

  common/* setupPath */.RY([`${rubyPrefix}\\bin`, ...toolchainPaths])

  if (!hasMSYS2PreInstalled) {
    await installMSYS2Tools()
  }

  if (version === 'mswin') {
    await installVCPkg()
  }

  const ridk = `${rubyPrefix}\\bin\\ridk.cmd`
  if (external_node_fs_.existsSync(ridk)) {
    await common/* measure */.xP('Adding ridk env variables', async () => addRidkEnv(ridk))
  }

  return rubyPrefix
}

function getArchitecture(architecture, version) {
  if (architecture === 'default') {
    if (windows_versions_versions['x64'][version]) {
      console.log(`Using x64 version of ${version}`)
      return 'x64'
    }

    if (windows_versions_versions['x86'][version]) {
      console.log(`Using x86 version of ${version}`)
      return 'x86'
    }

    return null
  }

  if (windows_versions_versions[architecture][version]) {
    console.log(`Using ${architecture} version of ${version}`)
    return architecture
  }

  return null
}

// Actions windows-2022 image does not contain any mingw or ucrt build tools.  Install tools for it,
// and also install ucrt tools on earlier versions, which have msys2 and mingw tools preinstalled.
async function installGCCTools(type) {
  const downloadPath = await common/* measure */.xP(`Downloading ${type} build tools`, async () => {
    let url = `${msys2GCCReleaseURI}/msys2-gcc-pkgs/${type}.7z`
    console.log(url)
    return await tool_cache/* downloadTool */.bq(url)
  })

  await common/* measure */.xP(`Extracting  ${type} build tools`, async () =>
    exec/* exec */.m('7z', ['x', downloadPath, '-aoa', '-bd', `-o${msys2BasePath}`], { silent: true }))
}

// Actions windows-2022 image does not contain any MSYS2 build tools.  Install tools for it.
// A subset of the MSYS2 base-devel group
async function installMSYS2Tools() {
  const downloadPath = await common/* measure */.xP(`Downloading msys2 build tools`, async () => {
    let url = `${msys2GCCReleaseURI}/msys2-gcc-pkgs/msys2.7z`
    console.log(url)
    return await tool_cache/* downloadTool */.bq(url)
  })

  // need to remove all directories, since they may indicate old packages are installed,
  // otherwise, error of "error: duplicated database entry"
  external_node_fs_.rmSync(`${msys2BasePath}\\var\\lib\\pacman\\local`, { recursive: true, force: true })

  await common/* measure */.xP(`Extracting  msys2 build tools`, async () =>
    exec/* exec */.m('7z', ['x', downloadPath, '-aoa', '-bd', `-o${msys2BasePath}`], { silent: true }))
}

// Windows JRuby can install gems that require compile tools, only needed for
// windows-2022 and later images
async function installJRubyTools() {
  await installMSYS2Tools()
  await installGCCTools('mingw64')
}

// Install vcpkg files needed to build mswin Ruby
async function installVCPkg() {
  const downloadPath = await common/* measure */.xP(`Downloading mswin vcpkg packages`, async () => {
    let url = `${msys2GCCReleaseURI}/msys2-gcc-pkgs/mswin.7z`
    console.log(url)
    return await tool_cache/* downloadTool */.bq(url)
  })

  await common/* measure */.xP(`Extracting  mswin vcpkg packages`, async () =>
    exec/* exec */.m('7z', ['x', downloadPath, '-aoa', '-bd', `-o${vcPkgBasePath}`], { silent: true }))
}

async function downloadAndExtract(engine, version, url, base, rubyPrefix) {
  const parentDir = external_node_path_.dirname(rubyPrefix)

  const downloadPath = await common/* measure */.xP('Downloading Ruby', async () => {
    console.log(url)
    return await tool_cache/* downloadTool */.bq(url)
  })

  await common/* measure */.xP('Extracting Ruby', async () =>
    exec/* exec */.m('7z', ['x', downloadPath, '-bd', `-xr!${base}\\share\\doc`, `-o${parentDir}`], { silent: true }))

  if (base !== external_node_path_.basename(rubyPrefix)) {
    await io.mv(external_node_path_.join(parentDir, base), rubyPrefix)
  }

  if (common/* shouldUseToolCache */.NR(engine, version)) {
    common/* createToolCacheCompleteFile */.U2(rubyPrefix)
  }
}

async function setupMingw(architecture, version) {
  core/* exportVariable */.dN('MAKE', 'make.exe')

  if (version.match(/^(1\.|2\.[0123])/)) {
    renameSystem32Dlls()
    core/* exportVariable */.dN('SSL_CERT_FILE', certFile)
    await common/* measure */.xP('Installing MSYS', async () => installMSYS(architecture, version))
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
  const downloadPath = await tool_cache/* downloadTool */.bq(url)
  const msys = architecture === 'x86' ? msysX86 : msysX64
  await exec/* exec */.m('7z', ['x', downloadPath, `-o${msys}`], { silent: true })

  // below are set in the old devkit.rb file ?
  core/* exportVariable */.dN('RI_DEVKIT', msys)
  core/* exportVariable */.dN('CC' , 'gcc')
  core/* exportVariable */.dN('CXX', 'g++')
  core/* exportVariable */.dN('CPP', 'cpp')
  core/* info */.pq(`Installed RubyInstaller DevKit for Ruby ${version}`)
}

async function setupMSWin() {
  core/* exportVariable */.dN('MAKE', 'nmake.exe')

  // Pre-installed OpenSSL use C:\Program Files\Common Files\SSL
  const certsDir = 'C:\\Program Files\\Common Files\\SSL\\certs'
  if (!external_node_fs_.existsSync(certsDir)) {
    external_node_fs_.mkdirSync(certsDir, { recursive: true })
  }

  // cert.pem location is hard-coded by OpenSSL msvc builds
  let cert = 'C:\\Program Files\\Common Files\\SSL\\cert.pem'
  if (!external_node_fs_.existsSync(cert)) {
    external_node_fs_.copyFileSync(certFile, cert)
  }

    // vcpkg openssl uses packages\openssl_x64-windows\certs
    certsDir = `${vcPkgBasePath}\\packages\\openssl_x64-windows\\certs`
    if (!external_node_fs_.existsSync(certsDir)) {
      external_node_fs_.mkdirSync(certsDir, { recursive: true })
    }

    // vcpkg openssl uses packages\openssl_x64-windows\cert.pem
    cert = `${vcPkgBasePath}\\packages\\openssl_x64-windows\\cert.pem`
    external_node_fs_.copyFileSync(certFile, cert)

  return await common/* measure */.xP('Setting up MSVC environment', async () => addVCVARSEnv())
}

/* Sets MSVC environment for use in Actions
 *   allows steps to run without running vcvars*.bat, also for PowerShell
 *   adds a convenience VCVARS environment variable
 *   this assumes a single Visual Studio version being available in the Windows images */
function addVCVARSEnv() {
  let cmd = 'vswhere -latest -property installationPath'
  let vcVars = `${external_node_child_process_.execSync(cmd).toString().trim()}\\VC\\Auxiliary\\Build\\vcvars64.bat`

  if (!external_node_fs_.existsSync(vcVars)) {
    throw new Error(`Missing vcVars file: ${vcVars}`)
  }
  core/* exportVariable */.dN('VCVARS', vcVars)

  cmd = `cmd.exe /c ""${vcVars}" && set"`

  let newEnv = new Map()
  let newSet = external_node_child_process_.execSync(cmd).toString().trim().split(/\r?\n/)
  newSet = newSet.filter(line => /\S=\S/.test(line))
  newSet.forEach(s => {
    let [k,v] = common/* partition */.jB(s, '=')
    newEnv.set(k,v)
  })

  let newPathEntries = undefined
  for (let [k, v] of newEnv) {
    if (process.env[k] !== v) {
      if (/^Path$/i.test(k)) {
        const newPathStr = v.replace(`${external_node_path_.delimiter}${process.env['Path']}`, '')
        newPathEntries = newPathStr.split(external_node_path_.delimiter)
      } else {
        core/* exportVariable */.dN(k, v)
      }
    }
  }
  return newPathEntries
}

// ssl files cause issues with non RI2 Rubies (<2.4) and ruby/ruby's CI from build folder due to dll resolution
function renameSystem32Dlls() {
  const sys32 = 'C:\\Windows\\System32\\'
  const badFiles = [`${sys32}libcrypto-1_1-x64.dll`, `${sys32}libssl-1_1-x64.dll`]
  const existing = badFiles.filter((dll) => external_node_fs_.existsSync(dll))
  if (existing.length > 0) {
    console.log(`Renaming ${existing.join(' and ')} to avoid dll resolution conflicts on Ruby <= 2.4`)
    existing.forEach(dll => external_node_fs_.renameSync(dll, `${dll}_`))
  }
}

// Sets MSYS2 ENV variables set from running `ridk enable`
function addRidkEnv(ridk) {
  let newEnv = new Map()
  let cmd = `cmd.exe /c "${ridk} enable && set"`
  let newSet = external_node_child_process_.execSync(cmd).toString().trim().split(/\r?\n/)
  newSet = newSet.filter(line => /^\S+=\S+/.test(line))
  newSet.forEach(s => {
    let [k, v] = common/* partition */.jB(s, '=')
    newEnv.set(k, v)
  })

  for (let [k, v] of newEnv) {
    if (process.env[k] !== v) {
      if (!/^Path$/i.test(k)) {
        console.log(`${k}=${v}`)
        core/* exportVariable */.dN(k, v)
      }
    }
  }
}

/***/ })

};
