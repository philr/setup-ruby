const os = require('os')
const fs = require('fs')
const path = require('path')
const exec = require('@actions/exec')
const io = require('@actions/io')
const tc = require('@actions/tool-cache')
const common = require('./common')
const rubyBuilderVersions = require('./ruby-builder-versions')

const builderReleaseTag = 'toolcache'
const releasesURL = 'https://github.com/philr/ruby-builder/releases'

const windows = common.windows

export function getAvailableVersions(platform, engine, architecture) {
  if (architecture === 'x86') return undefined;
  return rubyBuilderVersions.getVersions(platform)[engine]
}

export async function install(platform, engine, architecture, version) {
  if (architecture === 'x86') throw new Error(`Unsupported architecture: ${architecture}`)

  let rubyPrefix, inToolCache
  if (common.shouldUseToolCache(engine, version)) {
    inToolCache = tc.find('Ruby', version)
    if (inToolCache) {
      rubyPrefix = inToolCache
    } else {
      rubyPrefix = common.getToolCacheRubyPrefix(platform, 'x64', version)
    }
  } else if (windows) {
    rubyPrefix = path.join(`${common.drive}:`, `${engine}-${version}`)
  } else {
    rubyPrefix = path.join(os.homedir(), '.rubies', `${engine}-${version}`)
  }

  // Set the PATH now, so the MSYS2 'tar' is in Path on Windows
  common.setupPath([path.join(rubyPrefix, 'bin')])

  if (!inToolCache) {
    await downloadAndExtract(platform, engine, version, rubyPrefix);
  }

  return rubyPrefix
}

async function downloadAndExtract(platform, engine, version, rubyPrefix) {
  const parentDir = path.dirname(rubyPrefix)

  await io.rmRF(rubyPrefix)
  if (!(fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory())) {
    await io.mkdirP(parentDir)
  }

  const downloadPath = await common.measure('Downloading Ruby', async () => {
    const url = getDownloadURL(platform, engine, version)
    console.log(url)
    return await tc.downloadTool(url)
  })

  await common.measure('Extracting Ruby', async () => {
    if (windows) {
      // Windows 2016 doesn't have system tar, use MSYS2's, it needs unix style paths
      await exec.exec('tar', ['-xz', '-C', common.win2nix(parentDir), '-f', common.win2nix(downloadPath)])
    } else {
      await exec.exec('tar', ['-xz', '-C', parentDir, '-f', downloadPath])
    }
  })

  if (common.shouldUseToolCache(engine, version)) {
    common.createToolCacheCompleteFile(rubyPrefix)
  }
}

function getDownloadURL(platform, engine, version) {
  let builderPlatform = platform
  if (platform.startsWith('windows-')) {
    builderPlatform = 'windows-latest'
  } else if (platform.startsWith('macos-')) {
    const arch = os.arch()
    switch (arch) {
      case 'arm64':
        builderPlatform = 'macos-14-arm64'
        break
      default:
        builderPlatform = 'macos-latest'
        break
    }
  }

  if (common.isHeadVersion(version)) {
    throw new Error('Head versions are not available');
  } else {
    return `${releasesURL}/download/${builderReleaseTag}/${engine}-${version}-${builderPlatform}.tar.gz`
  }
}

function getLatestHeadBuildURL(platform, engine, version) {
  return `https://github.com/ruby/${engine}-dev-builder/releases/latest/download/${engine}-${version}-${platform}.tar.gz`
}
