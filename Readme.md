# Full Feeds

  Enhances RSS feeds by following their links, extracting additional content
  from those pages and incorporating it into a new feed.

  You're also able to modify the fetched URLs e.g. load a print friendly
  version or skip over ad posts.

## Requirements

  Dependencies:

  * async
  * feedparser
  * jsdom
  * redis
  * rss

  Full Feeds uses redis to cache the linked aticles so you'll need to have a
  server. Currently, the configuration for that is hardcoded to the defaults.

## Simple Example

    var fullfeeds = require('fullfeeds'),
        fs = require('fs');

    var config = [
      {
        name: 'paulgraham',
        url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss',
        // Optionally, you can specify a function to pull modify an article's URL.
        urlExtractor: function(article) {
          return article.guid;
        },
        // Use a Sizzle selector to specify the content on the page.
        selector: 'table table tr td'
      }
    ];

    // Invoke it with the configuration and a callback. The callback will be
    // passed an error and then results. Results will be an array with information
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
