var async = require('async'),
    redis = require("redis"),
    request = require('request'),
    jsdom  = require('jsdom'),
    FeedParser = require('feedparser'),
    RSS = require('rss'),
    client = redis.createClient();

var processFeed = function(config, finalCallback) {
  async.auto({
    fetch_feed: function(callback) {
      // Fetch a feed, convert it to JSON and pass it to the callback.
      console.log("%s: Fetching (%s)", config.name, config.url);
      (new FeedParser()).parseUrl(config.url, function(err, meta, articles) {
        callback(err, {meta: meta, articles: articles});
      });
    },

    extract_urls: ['fetch_feed', function(callback, results) {
      // Build an array of the articles that have truthy URLs.
      var urlExtractor = config.urlExtractor || function(a) { return a.link; },
          items = [];

      results.fetch_feed.articles.forEach(function (article) {
        var url = urlExtractor(article);
        if (url) {
          items.push({url: url, article: article});
        }
      });
      console.log("%s: Found %d items", config.name, items.length);
      callback(null, items);
    }],

    fetch_items: ['extract_urls', function(callback, results) {
      var itemFetcher = function (item, callback) {
        var key = "fullfeed:article:" + item.url;

        // Try to load a cached copy.
        client.get(key, function (err, res) {
          if (res !== null) {
            item.body = res;
            callback(err, item);
            return
          }
          console.log("%s: Fetching %s", config.name, item.url);
          // Have JSDOM fetch the page and parse it...
          jsdom.env(
            item.url,
            function(errors, window) {
              // jsdom has a customized version of sizzle that we can use.
              var Sizzle = require("jsdom/example/sizzle/sizzle").sizzleInit(window, window.document),
                  matches = Sizzle(config.selector);
              if (matches.length > 0) {
                item.body = matches[0].innerHTML;
              }
              // ...and store a cached copy for a week.
              client.setex(key, 60 * 60 * 24 * 7, item.body, redis.print);
              callback(errors, item);
            }
          );
        });
      }

      async.map(results.extract_urls, itemFetcher, callback);
    }],

    build_feed: ['fetch_items', function(callback, results) {
      console.log("%s: Building feed", config.name);
      // Build an array of the articles that have truthy URLs.
      var meta = results.fetch_feed.meta,
          feedOut = new RSS({
            // author: 'Dylan Greene',
            title: meta.title,
            description: meta.description,
            site_url: meta.link,
            feed_url: config.url,
            // image_url: 'http://example.com/icon.png',
          });

      results.fetch_items.forEach(function (item) {
        if (item.body) {
          feedOut.item({
            title: item.article.title,
            url: item.article.link,
            guid: item.article.guid,
            date: item.article.pubDate,
            description: item.body
          });
        }
      });

      callback(null, feedOut);
    }],

    save_feed: ['build_feed', function(callback, results) {
      var path = __dirname + '/public/' + config.name + '.xml';
      var fs = require('fs');
      console.log("%s: Saving to %s", config.name, path);
      fs.writeFile(path, results.build_feed.xml(), function(err) {
        callback(err, path);
      });
   }]
  }, finalCallback);
}


var wapoLink = function(article) {
  // Skip ads.
  return (article.link.indexOf("ads.pheedo.com") === -1) ? article.guid : false;
};
var feedConfig = [
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

var actions = [];
feedConfig.forEach(function(config) {
  actions.push(function (callback) { processFeed(config, callback); });
});
// Process the feeds in parallel and then shutdown the redis client.
async.parallel(actions, function() { client.end(); });
