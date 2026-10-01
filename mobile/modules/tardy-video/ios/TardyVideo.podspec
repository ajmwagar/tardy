Pod::Spec.new do |s|
  s.name           = 'TardyVideo'
  s.version        = '0.1.0'
  s.summary        = 'Edge-to-edge video with a live blurred backdrop for Tardy Reels.'
  s.description    = s.summary
  s.license        = 'AGPL-3.0'
  s.author         = 'FPL'
  s.homepage       = 'https://github.com/ajmwagar/tardy'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
