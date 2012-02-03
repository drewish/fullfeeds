var async = require('async'),
    redis = require("redis"),
    jsdom  = require('jsdom'),
    FeedParser = require('feedparser'),
    RSS = require('rss');

var processFeed = function(feedConfig, finalCallback) {
  async.auto({
    // Bit of an artifical step to get the config in a constant place
    config: function(callback) {
      callback(null, feedConfig);
    },

    // Use feed parser to fetch a feed, convert it to JSON.
    fetch_feed: ['config', function(callback, results) {
      console.log("%s: Fetching (%s)", results.config.name, results.config.url);
      (new FeedParser()).parseUrl(results.config.url, function(err, meta, articles) {
        callback(err, {meta: meta, articles: articles});
      });
    }],

    // Build an array of the article URLs. We'll skip over false values.
    extract_urls: ['fetch_feed', function(callback, results) {
      var items = [],
          urlExtractor = results.config.urlExtractor || function(a) { return a.link; };
      results.fetch_feed.articles.forEach(function (article) {
        items.push(urlExtractor(article));
      });
      console.log("%s: Found %d items", results.config.name, items.length);
      callback(null, items);
    }],

    // Try to fetch the linked article and extract its content.
    fetch_items: ['extract_urls', function(callback, results) {
      var client = redis.createClient();
      var itemFetcher = function (url, fetchedCallback) {
        var key = "fullfeed:article:" + url;

        if (!url) {
          return fetchedCallback(null, false);
        }

        // Try to load a cached copy.
        client.get(key, function (err, res) {
          if (res !== null) {
            return fetchedCallback(err, res);
          }
          console.log("%s: Fetching %s", results.config.name, url);
          // Have JSDOM fetch the page and parse it...
          jsdom.env(
            url,
            function(errors, window) {
              // jsdom has a customized version of sizzle that we can use.
              var Sizzle = require("jsdom/example/sizzle/sizzle").sizzleInit(window, window.document),
                  matches = Sizzle(results.config.selector);
                  content = false;
              if (matches.length > 0) {
                body = matches[0].innerHTML;
              }
              // ...and store a cached copy for a week.
              client.setex(key, 60 * 60 * 24 * 7, body, redis.print);
              return fetchedCallback(errors, body);
            }
          );
        });
      }

      async.map(results.extract_urls, itemFetcher, function(err, results) {
        client.end();
        callback(err, results);
      });
    }],

    // Generate a new feed with the full text of the articles.
    build_feed: ['fetch_items', function(callback, results) {
      console.log("%s: Building feed", results.config.name);
      var meta = results.fetch_feed.meta,
          feedOut = new RSS({
            // author: 'Dylan Greene',
            title: meta.title,
            description: meta.description,
            site_url: meta.link,
            feed_url: results.config.url,
            // image_url: 'http://example.com/icon.png',
          });

      for (var i = 0; i < results.fetch_feed.articles.length; i++) {
        if (results.fetch_items[i]) {
          var article = results.fetch_feed.articles[i];
          feedOut.item({
            title: article.title,
            url: article.link,
            guid: article.guid,
            date: article.pubDate,
            description: results.fetch_items[i]
          });
        }
      }

      callback(null, feedOut);
    }]
  }, finalCallback);
}

// For each config item build a feed.
module.exports = function(config, callback) {
  var actions = [];
  config.forEach(function(feed) {
    actions.push(function (callback) { processFeed(feed, callback); });
  });
  async.parallel(actions, callback);
};