# setup-ruby (legacy)

This action downloads a prebuilt ruby and adds it to the `PATH`.

It is very efficient and takes about 5 seconds to download, extract and add the given Ruby to the `PATH`.
No extra packages need to be installed.

Compared to [actions/setup-ruby](https://github.com/actions/setup-ruby),
this actions supports many more versions and features.

## Supported Versions

This legacy version of the setup-ruby action currently supports these versions of MRI, JRuby and TruffleRuby:

| Interpreter | Versions |
| ----------- | -------- |
| `ruby` | 1.8.7-p375 (Ubuntu 20.04 and 22.04 only), 1.9.3-p551, 2.0.0-p648 |
| `jruby` | 1.7.27, 9.0.5.0, 9.1.17.0, 9.2.21.0 |

On Windows, versions 1.8.7-p375 and 1.9.3-p551 are 32-bit x86 builds. Version 2.0.0-p648 is available as either a 32-bit x86 build or a 64-bit x64 build (selectable with the optional architecture input).

Note that all these Ruby versions and the OpenSSL versions they need are end-of-life, unmaintained and should be considered insecure.

## Supported Platforms

The action works for all [GitHub-hosted runners](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/virtual-environments-for-github-hosted-runners), with exceptions as noted above.

| Operating System | Recommended | Other Supported Versions |
| ----------- | -------- | -------- |
| Ubuntu  | `ubuntu-latest` (= `ubuntu-24.04`) | `ubuntu-20.04`, `ubuntu-22.04` |
| macOS   | `macos-13` | `macos-13-large`, `macos-14-large`, `macos-14-xlarge` |
| Windows | `windows-latest` (= `windows-2022`) | `windows-2019` |

The prebuilt releases are generated by [ruby-builder](https://github.com/philr/ruby-builder)
and on Windows by [RubyInstaller](https://github.com/oneclick/rubyinstaller).
The full list of available Ruby versions can be seen in [ruby-builder-versions.js](ruby-builder-versions.js)
for Ubuntu and macOS and in [windows-versions.js](windows-versions.js) for Windows.

## Usage

### Single Job

```yaml
name: My workflow
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: ruby/setup-ruby@v1
      with:
        ruby-version: '1.9.3' # Not needed with a .ruby-version file
        bundler-cache: true # runs 'bundle install' and caches installed gems automatically
    - run: bundle exec rake
```

### Matrix of Ruby Versions

This matrix tests all supported versions of MRI and JRuby on Ubuntu, macOS and Windows.

```yaml
name: My workflow
on: [push]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        ruby: [1.8.7, 1.9.3, '2.0.0', jruby-1.7, jruby-9.0]
        exclude:
          - os: macos-latest
            ruby: '1.8.7'
            architecture: default
          - os: windows-latest
            ruby: '1.8.7'
            architecture: default
          - os: windows-latest
            ruby: 'jruby-1.7'
            architecture: default
    runs-on: ${{ matrix.os }}
    steps:
    - uses: actions/checkout@v4
    - uses: philr/setup-ruby@legacy-v1
      with:
        ruby-version: ${{ matrix.ruby }}
        bundler-cache: true # runs 'bundle install' and caches installed gems automatically
    - run: bundle exec rake
```

### Matrix of Gemfiles

```yaml
name: My workflow
on: [push]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        gemfile: [ rails5, rails6 ]
    runs-on: ubuntu-latest
    env: # $BUNDLE_GEMFILE must be set at the job level, so it is set for all steps
      BUNDLE_GEMFILE: gemfiles/${{ matrix.gemfile }}.gemfile
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          ruby-version: 2.0.0
          bundler-cache: true # runs 'bundle install' and caches installed gems automatically
      - run: bundle exec rake
```

See the GitHub Actions documentation for more details about the
[workflow syntax](https://help.github.com/en/actions/reference/workflow-syntax-for-github-actions)
and the [condition and expression syntax](https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions).

### Supported Version Syntax

* engine-version like `ruby-1.9.3` and `jruby-9.0.5.0`
* short version like `1.9`, automatically using the latest release matching that version (`1.9.3`)
* version only like `1.9.3`, assumes MRI for the engine
* engine only like `jruby`, uses the latest stable legacy release of that implementation
* `.ruby-version` reads from the project's `.ruby-version` file
* `.tool-versions` reads from the project's `.tool-versions` file
* If the `ruby-version` input is not specified, `.ruby-version` is tried first, followed by `.tool-versions`

### Working Directory

The `working-directory` input can be set to resolve `.ruby-version`, `.tool-versions` and `Gemfile.lock`
if they are not at the root of the repository, see [action.yml](action.yml) for details.

### Bundler

By default, if there is a `Gemfile.lock` file (or `$BUNDLE_GEMFILE.lock` or `gems.locked`) with a `BUNDLED WITH` section,
that version of Bundler will be installed and used.
Otherwise, the latest compatible Bundler version is installed (Bundler 1).

This behavior can be customized, see [action.yml](action.yml) for more details about the `bundler` input.

### Caching `bundle install` automatically

This action provides a way to automatically run `bundle install` and cache the result:
```yaml
    - uses: ruby/setup-ruby@v1
      with:
        bundler-cache: true
```

Note that any step doing `bundle install` (for the root `Gemfile`) or `gem install bundler` can be removed with `bundler-cache: true`.

This caching speeds up installing gems significantly and avoids too many requests to RubyGems.org.  
It needs a `Gemfile` (or `$BUNDLE_GEMFILE` or `gems.rb`) under the [`working-directory`](#working-directory).  
If there is a `Gemfile.lock` (or `$BUNDLE_GEMFILE.lock` or `gems.locked`), `bundle config --local deployment true` is used.

To use a `Gemfile` which is not at the root or has a different name, set `BUNDLE_GEMFILE` in the `env` at the job level
as shown in the [example](#matrix-of-gemfiles).

To perform caching, this action will use `bundle config --local path $PWD/vendor/bundle`.  
Therefore, the Bundler `path` should not be changed in your workflow for the cache to work (no `bundle config path`).

## Windows

Note that running CI on Windows can be quite challenging if you are not very familiar with Windows.
It is recommended to first get your build working on Ubuntu and macOS before trying Windows.

* The default shell on Windows is not Bash but [PowerShell](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#using-a-specific-shell).
  This can lead issues such as multi-line scripts [not working as expected](https://github.com/ruby/setup-ruby/issues/13).
* The `PATH` contains [multiple compiler toolchains](https://github.com/ruby/setup-ruby/issues/19). Use `where.exe` to debug which tool is used.
* For Ruby builds, the DevKit MSYS tools are installed and prepended to the `Path`.
* JRuby on Windows has a known bug that `bundle exec rake` [fails](https://github.com/ruby/setup-ruby/issues/18).

## Versioning

It is highly recommended to use `ruby/setup-ruby@legacy-v1` for the version of this action.
This will provide the best experience by automatically getting bug fixes, new Ruby versions and new features.

If you instead choose a specific version (legacy-v1.2.3) or a commit sha, there will be no automatic bug fixes and
it will be your responsibility to update every time the action no longer works.
Make sure to always use the latest release before reporting an issue on GitHub.

This action follows semantic versioning with a moving `legacy-v1` branch.
This follows the [recommendations](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md) of GitHub Actions.

## Using self-hosted runners

This action might work with [self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners)
if the [virtual environment](https://github.com/actions/virtual-environments) is very similar to the ones used by GitHub runners. Notably:

* Make sure to use the same operating system and version.
* Set the environment variable `ImageOS` to the corresponding value on GitHub-hosted runners (e.g. `ubuntu20`/`macos11`/`win22`). This is necessary to detect the operating system and version.
* Make sure to use the same version of libssl.
* Make sure that the operating system has `libyaml-0` installed
* The default tool cache directory (`/opt/hostedtoolcache` on Linux, `/Users/runner/hostedtoolcache` on macOS,
  `C:/hostedtoolcache/windows` on Windows) must be writable by the `runner` user.
  This is necessary since the Ruby builds embed the install path when built and cannot be moved around.
* `/home/runner` must be writable by the `runner` user.

In other cases, please use a system Ruby or [install Ruby manually](https://github.com/postmodern/chruby/wiki#installing-rubies) instead.

## History

This action is forked from `ruby/setup-ruby`.

## Credits

The current maintainer of this action is @eregon.
Most of the Windows logic is based on work by MSP-Greg.
Many thanks to MSP-Greg and Lars Kanis for the help with Ruby Installer.
