require 'net/http'
require 'yaml'
require 'json'

min_requirements = ['~> 2.0.0'].map { |req| Gem::Requirement.new(req) }

url = 'https://raw.githubusercontent.com/oneclick/rubyinstaller.org-website/master/_data/downloads.yaml'
entries = YAML.load(Net::HTTP.get(URI(url)), symbolize_names: true)

versions = entries.select { |entry|
  entry[:filetype] == 'rubyinstaller7z'
}.group_by { |entry|
  raise "unexpected name: #{entry[:name]}" unless entry[:name] =~ /Ruby (\d+\.\d+\.\d+)(?:.*\((x64|x86)\))?/
  [$2 || 'x86', $1]
}.map { |(architecture, version), builds|
  unless builds.sort_by { |build| build[:name] } == builds.reverse
    raise "not sorted as expected for #{version} (#{architecture})"
  end
  [architecture, version, builds.first]
}.sort_by { |architecture, version, entry|
  Gem::Version.new(version)
}.select { |architecture, version, entry|
  min_requirements.any? { |req| req.satisfied_by?(Gem::Version.new(version)) }
}.group_by { |architecture, version, entry|
  architecture
}

versions.each { |architecture, arch_versions|
  versions[architecture] = arch_versions.map { | _, version, entry |
    [version, entry[:href]]
  }.to_h
}

js = "export const versions = #{JSON.pretty_generate(versions)}\n"
File.write 'windows-versions.js', js
