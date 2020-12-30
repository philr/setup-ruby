require 'rbconfig'
require 'stringio'

puts "CPPFLAGS: #{RbConfig::CONFIG["CPPFLAGS"]}"

$stderr = StringIO.new
begin
  ruby = File.join(RbConfig::CONFIG['bindir'], RbConfig::CONFIG['ruby_install_name'] + RbConfig::CONFIG['EXEEXT'])
  system ruby, "-e", "p :OK"
  out = $stderr.string
ensure
  $stderr = STDERR
end
abort out unless out.empty?
