require 'rbconfig'
require 'stringio'

puts "CPPFLAGS: #{RbConfig::CONFIG["CPPFLAGS"]}"

$stderr = StringIO.new
begin
  ruby = File.join(RbConfig::CONFIG['bindir'], RbConfig::CONFIG['ruby_install_name'] + RbConfig::CONFIG['EXEEXT'])
  system ruby, "-e", "p :OK"
  if RUBY_ENGINE == 'jruby'
    out = []
    $stderr.rewind
    $stderr.each_line do |s|
      # Ignore warnings from the JVM.
      out << s unless s =~ /\AWARNING: .*([Ii]llegal|reporting)/
    end
    out = out.join('')
  else
    out = $stderr.string
  end
ensure
  $stderr = STDERR
end
abort out unless out.empty?
