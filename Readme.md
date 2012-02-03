# Full Feeds

  Enhances RSS feeds by following their links, extracting additional additional
  content from those pages and incorporating it into a new feed.

## Requirements

  Full Feeds uses redis to cache the linked aticles so you'll need to have a
  server. Currently, the configuration for that is hard to the defaults.

## Simple Example

    var fullfeeds = require('fullfeeds'),
        fs = require('fs');

    var config = [
      {
        name: 'paulgraham',
        url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss',
        // Use a Sizzle selector to specify the content on the page.
        selector: 'table table tr td'
      }
    ];

    fullfeeds(config, function(err, results) {
      results.forEach(function(result) {
        var path = __dirname + '/output/' + result.config.name + '.xml';
        console.log("%s: Saving to %s", result.config.name, path);
        fs.writeFile(path, result.build_feed.xml(), function(err) {
          if (err) {
            console.error(err);
          }
        });
      })
    });
