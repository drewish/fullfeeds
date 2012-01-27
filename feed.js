var feedInfo = function(feedName) {
  var wapoContent = function($) {
    return $('#entrytext').html();
  };
  var wapoLink = function(article) {
    // Skip ads.
    if (article.link.indexOf("ads.pheedo.com") === -1) {
      return article.guid;
    }
    console.log("Skipping %s", article.link);
    return false;
  };
  var feeds = {
    'plumline': {
      url: 'http://feeds.washingtonpost.com/rss/rss_plum-line',
      urlExtractor: wapoLink,
      contentExtractor: wapoContent
    },
    'ezraklein': {
      url: 'http://feeds.washingtonpost.com/rss/rss_ezra-klein',
      urlExtractor: wapoLink,
      contentExtractor: wapoContent
    },
  };
  return feeds[feedName];
}

var processFeed = function(feedName, finalCallback) {
  var FeedParser = require('feedparser')
    , RSS = require('rss')
    , async = require('async');


  async.auto({
    fetch_source: function(callback) {
      var url = feedInfo(feedName).url;
      // Fetch a feed, convert it to JSON and pass it to the callback.
      console.log("Fetching %s", url);
      (new FeedParser()).parseUrl(url, function(err, meta, articles) {
        callback(err, {meta: meta, articles: articles});
      });
    },
    // Take the feed fetch its articles and assemble their contents into a new
    // feed.
    build_feed: ['fetch_source', function(callback, results) {
      var request = require('request')
        , jsdom  = require('jsdom');

      // Build an array of the articles that have truthy URLs.
      var urlExtractor = feedInfo(feedName).urlExtractor
        , meta = results.fetch_source.meta
        , articles = results.fetch_source.articles.filter(urlExtractor);

      console.log("%s [%s] (%d articles to fetch)", meta.title, meta.link, articles.length);

      var feedOut = new RSS({
        // author: 'Dylan Greene',
        title: meta.title,
        description: meta.description,
        site_url: meta.link,
        // feed_url: 'http://example.com/rss.xml',
        // image_url: 'http://example.com/icon.png',
      });

      async.forEachSeries(
        articles,
        function (article, finished) {
          var articleUrl = urlExtractor(article);
          request(
            { 'uri': articleUrl, 'headers': {'User-Agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)'} },
            function (err, response, body) {
              if (err) {
                finished(err);
              }
              if (!response || response.statusCode != 200) {
                finished(new Error('Request to ' + articleUrl + ' ended with status code: ' + (typeof response !== 'undefined' ? response.statusCode : 'unknown')));
              }
              else {
                console.log('fetched');
                var window = jsdom.jsdom().createWindow();
                body = body.replace(/<(\/?)script/g, '<$1nobreakage');
                jsdom.jQueryify(window, __dirname + '/public/javascripts/jquery-1.6.1.min.js', function(win, $) {
                  $('head').append($(body).find('head').html());
                  $('body').append($(body).find('body').html());

                  // extractor can skip an item by returning false.
                  var content = feedInfo(feedName).contentExtractor($);
                  if (content !== false) {
                    feedOut.item({
                      title: article.title,
                      url: article.link,
                      guid: article.guid,
                      date: article.pubDate,
                      description: content
                    });
                  }
                  finished();
                });
              }
            }
          );
        },
        function (err) { callback(err, feedOut); }
      );
    }],
    save_feed: ['build_feed', function(callback, results) {
      var path = __dirname + '/public/' + feedName + '.xml';
      var fs = require('fs');
      fs.writeFile(path, results.build_feed.xml(), function(err) {
        if (err) {
          console.log(err);
          callback(err);
        }
        else {
          console.log("The file was saved to %s", path);
          callback();
        }
      });
    }]
  });
}


processFeed('plumline');
processFeed('ezraklein');
