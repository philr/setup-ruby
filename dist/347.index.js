export const id = 347;
export const ids = [347];
export const modules = {

/***/ 99347:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  getAvailableVersions: () => (/* binding */ getAvailableVersions),
  install: () => (/* binding */ install)
});

// EXTERNAL MODULE: external "node:os"
var external_node_os_ = __webpack_require__(48161);
// EXTERNAL MODULE: external "node:fs"
var external_node_fs_ = __webpack_require__(73024);
// EXTERNAL MODULE: external "node:path"
var external_node_path_ = __webpack_require__(76760);
// EXTERNAL MODULE: ./node_modules/@actions/exec/lib/exec.js
var exec = __webpack_require__(95236);
// EXTERNAL MODULE: ./node_modules/@actions/io/lib/io.js
var io = __webpack_require__(94994);
// EXTERNAL MODULE: ./node_modules/@actions/tool-cache/lib/tool-cache.js
var tool_cache = __webpack_require__(33472);
// EXTERNAL MODULE: ./common.js + 1 modules
var common = __webpack_require__(92409);
;// CONCATENATED MODULE: ./ruby-builder-versions.js
function getVersions(platform) {
  const versions = {
    "ruby": [
      "1.8.7-p375",
      "1.9.3-p551",
      "2.0.0-p648"
    ],
    "jruby": [
      "1.7.27",
      "9.0.5.0",
      "9.1.17.0",
      "9.2.21.0"
    ]
  }

  return versions
}

;// CONCATENATED MODULE: ./ruby-builder.js









const builderReleaseTag = 'toolcache'
const releasesURL = 'https://github.com/philr/ruby-builder/releases'

const windows = common/* windows */.KF

function getAvailableVersions(platform, engine, architecture) {
  if (architecture === 'x86') return undefined;
  return getVersions(platform)[engine]
}

async function install(platform, engine, architecture, version) {
  if (architecture === 'x86') throw new Error(`Unsupported architecture: ${architecture}`)

  let rubyPrefix, inToolCache
  if (common/* shouldUseToolCache */.NR(engine, version)) {
    inToolCache = tool_cache.find('Ruby', version)
    if (inToolCache) {
      rubyPrefix = inToolCache
    } else {
      rubyPrefix = common/* getToolCacheRubyPrefix */.X9(platform, 'x64', version)
    }
  } else if (windows) {
    rubyPrefix = external_node_path_.join(`${common/* drive */.rU}:`, `${engine}-${version}`)
  } else {
    rubyPrefix = external_node_path_.join(external_node_os_.homedir(), '.rubies', `${engine}-${version}`)
  }

  // Set the PATH now, so the MSYS2 'tar' is in Path on Windows
  common/* setupPath */.RY([external_node_path_.join(rubyPrefix, 'bin')])

  if (!inToolCache) {
    await downloadAndExtract(platform, engine, version, rubyPrefix);
  }

  return rubyPrefix
}

async function downloadAndExtract(platform, engine, version, rubyPrefix) {
  const parentDir = external_node_path_.dirname(rubyPrefix)

  await io.rmRF(rubyPrefix)
  if (!(external_node_fs_.existsSync(parentDir) && external_node_fs_.statSync(parentDir).isDirectory())) {
    await io.mkdirP(parentDir)
  }

  const downloadPath = await common/* measure */.xP('Downloading Ruby', async () => {
    const url = getDownloadURL(platform, engine, version)
    console.log(url)
    return await tool_cache.downloadTool(url)
  })

  await common/* measure */.xP('Extracting Ruby', async () => {
    if (windows) {
      // Windows 2016 doesn't have system tar, use MSYS2's, it needs unix style paths
      await exec.exec('tar', ['-xz', '-C', common/* win2nix */.O6(parentDir), '-f', common/* win2nix */.O6(downloadPath)])
    } else {
      await exec.exec('tar', ['-xz', '-C', parentDir, '-f', downloadPath])
    }
  })

  if (common/* shouldUseToolCache */.NR(engine, version)) {
    common/* createToolCacheCompleteFile */.U2(rubyPrefix)
  }
}

function getDownloadURL(platform, engine, version) {
  let builderPlatform = platform
  if (platform.startsWith('windows-')) {
    builderPlatform = 'windows-latest'
  } else if (platform.startsWith('macos-')) {
    const arch = external_node_os_.arch()
    switch (arch) {
      case 'arm64':
        builderPlatform = 'macos-14-arm64'
        break
      default:
        builderPlatform = 'macos-latest'
        break
    }
  }

  if (common/* isHeadVersion */.vR(version)) {
    throw new Error('Head versions are not available');
  } else {
    return `${releasesURL}/download/${builderReleaseTag}/${engine}-${version}-${builderPlatform}.tar.gz`
  }
}

function getLatestHeadBuildURL(platform, engine, version) {
  return `https://github.com/ruby/${engine}-dev-builder/releases/latest/download/${engine}-${version}-${platform}.tar.gz`
}


/***/ })

};
