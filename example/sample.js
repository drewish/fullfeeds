var fullfeeds = require('../lib/fullfeeds'),
    fs = require('fs'),
    request = require('request');

var config = [
  {
    name: 'plumline',
    url: 'http://feeds.washingtonpost.com/rss/rss_plum-line',
    urlExtractor: function(article, callback) {
      // They put a redirect URL in the first result that we need to follow.
      var redirectMatcher = /"og:url" content="(.+?)"\/>/
      request(article.guid, function (error, response, body) {
        if (error) return callback(error);
        if (response.statusCode != 200) return callback("bad fetch...");
        var matches = redirectMatcher.exec(body);
        if (!matches) return callback("no match...");
        callback(null, matches[1]);
      });
    },
    selector: '.entry-content',
  },
  {
    name: 'taibbi',
    url: 'http://www.rollingstone.com/siteServices/rss/taibbiBlog',
    selector: '.blog-post-content'
  },
  {
    name: 'paulgraham',
    url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss',
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
