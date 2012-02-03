var fullfeeds = require('../lib/fullfeeds');

var wapoLink = function(article) {
  // Skip ads.
  return (article.link.indexOf("ads.pheedo.com") === -1) ? article.guid : false;
};
var config = [
  {
    name: 'plumline',
    url: 'http://feeds.washingtonpost.com/rss/rss_plum-line',
    urlExtractor: wapoLink,
    selector: '#entrytext',
  },
  {
    name: 'ezraklein',
    url: 'http://feeds.washingtonpost.com/rss/rss_ezra-klein',
    urlExtractor: wapoLink,
    selector: '#article_body'
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
    var fs = require('fs');
    console.log("%s: Saving to %s", result.config.name, path);
    fs.writeFile(path, result.build_feed.xml(), function(err) {
      if (err) {
        console.error(err);
      }
    });
  })
});
