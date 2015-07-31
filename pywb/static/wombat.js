/*
Copyright(c) 2013-2015 Ilya Kreymer. Released under the GNU General Public License.

This file is part of pywb, https://github.com/ikreymer/pywb

    pywb is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    pywb is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with pywb.  If not, see <http://www.gnu.org/licenses/>.
 */

//============================================
// Wombat JS-Rewriting Library v2.6
//============================================



_WBWombat = (function() {


var wombat_internal = function($wbwindow) {

    // Globals
    var wb_replay_prefix;
    var wb_replay_date_prefix;
    var wb_coll_prefix;
    var wb_coll_prefix_check;
    var wb_capture_date_part;
    var wb_orig_scheme;
    var wb_orig_origin;
    var wb_curr_host;

    var wb_setAttribute = $wbwindow.Element.prototype.setAttribute;
    var wb_getAttribute = $wbwindow.Element.prototype.getAttribute;

    var wb_info;

    var wb_wombat_updating = false;

    // custom options
    var wb_opts;

    //============================================
    function is_host_url(str) {
        // Good guess that's its a hostname
        if (str.indexOf("www.") == 0) {
            return true;
        }

        // hostname:port (port required)
        var matches = str.match(/^[\w-]+(\.[\w-_]+)+(:\d+)(\/|$)/);
        if (matches && (matches[0].length < 64)) {
            return true;
        }

        // ip:port
        matches = str.match(/^\d+\.\d+\.\d+\.\d+(:\d+)?(\/|$)/);
        if (matches && (matches[0].length < 64)) {
            return true;
        }

        return false;
    }

    //============================================
    function starts_with(string, arr_or_prefix) {
        if (!string) { return undefined; }

        if (arr_or_prefix instanceof Array) {
            for (var i = 0; i < arr_or_prefix.length; i++) {
                if (string.indexOf(arr_or_prefix[i]) == 0) {
                    return arr_or_prefix[i];
                }
            }
        } else if (string.indexOf(arr_or_prefix) == 0) {
            return arr_or_prefix;
        }

        return undefined;
    }

    //============================================
    function equals_any(string, arr) {
        for (var i = 0; i < arr.length; i++) {
            if (string === arr[i]) {
                return arr[i];
            }
        }
        return undefined;
    }

    //============================================
    function ends_with(str, suffix) {
        if (str.indexOf(suffix, str.length - suffix.length) !== -1) {
            return suffix;
        } else {
            return undefined;
        }
    }

    //============================================
    var rewrite_url = rewrite_url_;

    function rewrite_url_debug(url) {
        var rewritten = rewrite_url_(url);
        if (url != rewritten) {
            console.log('REWRITE: ' + url + ' -> ' + rewritten);
        } else {
            console.log('NOT REWRITTEN ' + url);
        }
        return rewritten;
    }

    //============================================
    var HTTP_PREFIX = "http://";
    var HTTPS_PREFIX = "https://";
    var REL_PREFIX = "//";

    var VALID_PREFIXES = [HTTP_PREFIX, HTTPS_PREFIX, REL_PREFIX];
    var IGNORE_PREFIXES = ["#", "about:", "data:", "mailto:", "javascript:", "{", "*"];

    var BAD_PREFIXES;

    function init_bad_prefixes(prefix) {
        BAD_PREFIXES = ["http:" + prefix, "https:" + prefix,
                        "http:/" + prefix, "https:/" + prefix];
    }

    var SRC_TAGS = ["IFRAME", "IMG", "SCRIPT", "VIDEO", "AUDIO", "SOURCE", "EMBED", "INPUT"];

    var HREF_TAGS = ["LINK", "A"];

    var REWRITE_ATTRS = ["src", "href", "poster"];

    var URL_PROPS = ["href", "hash", "pathname", "host", "hostname", "protocol", "origin", "search", "port"];

    //============================================
    function rewrite_url_(url) {
        // If undefined, just return it
        if (!url) {
            return url;
        }

        var urltype_ = (typeof url);

        // If object, use toString
        if (urltype_ == "object") {
            url = url.toString();
        } else if (urltype_ != "string") {
            return url;
        }

        // proxy mode: If no wb_replay_prefix, only rewrite https:// -> http://
        if (!wb_replay_prefix) {
            if (starts_with(url, HTTPS_PREFIX)) {
                return HTTP_PREFIX + url.substr(HTTPS_PREFIX.length);
            } else {
                return url;
            }
        }

        // just in case wombat reference made it into url!
        url = url.replace("WB_wombat_", "");

        // ignore anchors, about, data
        if (starts_with(url, IGNORE_PREFIXES)) {
            return url;
        }

        // OPTS: additional ignore prefixes
        if (wb_opts.no_rewrite_prefixes) {
            if (starts_with(url, wb_opts.no_rewrite_prefixes)) {
                return url;
            }
        }

        // If starts with prefix, no rewriting needed
        // Only check replay prefix (no date) as date may be different for each
        // capture
        if (starts_with(url, wb_replay_prefix) || starts_with(url, $wbwindow.location.origin + wb_replay_prefix)) {
            return url;
        }

        // A special case where the port somehow gets dropped
        // Check for this and add it back in, eg http://localhost/path/ -> http://localhost:8080/path/
        if ($wbwindow.location.host != $wbwindow.location.hostname) {
            if (starts_with(url, $wbwindow.location.protocol + '//' + $wbwindow.location.hostname + "/")) {
                url = url.replace("/" + $wbwindow.location.hostname + "/", "/" + $wbwindow.location.host + "/");
                return url;
            }
        }

        // If server relative url, add prefix and original host
        if (url.charAt(0) == "/" && !starts_with(url, REL_PREFIX)) {

            // Already a relative url, don't make any changes!
            if (wb_capture_date_part && url.indexOf(wb_capture_date_part) >= 0) {
                return url;
            }

            // relative collection 
            if ((url.indexOf(wb_info.coll) == 1) && (url.indexOf("http") > 1)) {
                var scheme_sep = url.indexOf(":/");
                if (scheme_sep > 0 && url[scheme_sep + 2] != '/') {
                    url = url.substring(0, scheme_sep + 2) + "/" + url.substring(scheme_sep + 2);
                }
                return url;
            }

            return wb_replay_date_prefix + wb_orig_origin + url;
        }

        // If full url starting with http://, https:// or //
        // add rewrite prefix
        var prefix = starts_with(url, VALID_PREFIXES);

        if (prefix) {
            var orig_host = $wbwindow.top.location.host;
            var orig_protocol = $wbwindow.top.location.protocol;

            var prefix_host = prefix + orig_host + '/';

            // if already rewritten url, must still check scheme
            if (starts_with(url, prefix_host)) {
                if (starts_with(url, wb_replay_prefix)) {
                    return url;
                }

                var curr_scheme = orig_protocol + '//';
                var host = orig_host + '/';
                var path = url.substring(prefix_host.length);
                var rebuild = false;

                if (path.indexOf(wb_coll_prefix_check) < 0 && url.indexOf("/static/") < 0) {
                    path = wb_coll_prefix + WB_wombat_location.origin + "/" + path;
                    rebuild = true;
                }

                // replace scheme to ensure using the correct server scheme
                //if (starts_with(url, wb_orig_scheme) && (wb_orig_scheme != curr_scheme)) {
                if (prefix != curr_scheme && prefix != REL_PREFIX) {
                    rebuild = true;
                }

                if (rebuild) {
                    url = curr_scheme + host + path;
                }

                return url;
            }
            return wb_replay_date_prefix + url;
        }

        // Check for common bad prefixes and remove them
        prefix = starts_with(url, BAD_PREFIXES);

        if (prefix) {
            url = extract_orig(url);
            return wb_replay_date_prefix + url;
        }

        // May or may not be a hostname, call function to determine
        // If it is, add the prefix and make sure port is removed
        if (is_host_url(url) && !starts_with(url, $wbwindow.location.host + '/')) {
            return wb_replay_date_prefix + wb_orig_scheme + url;
        }

        return url;
    }

    //============================================
    function extract_orig(href) {
        if (!href) {
            return "";
        }

        // proxy mode: no extraction needed
        if (!wb_replay_prefix) {
            return href;
        }

        href = href.toString();

        // ignore certain urls
        if (starts_with(href, IGNORE_PREFIXES)) {
            return href;
        }

        var index = href.indexOf("/http", 1);
        if (index < 0) {
            index = href.indexOf("///", 1);
        }

        // extract original url from wburl
        if (index > 0) {
            href = href.substr(index + 1);
        } else {
            index = href.indexOf(wb_replay_prefix);
            if (index >= 0) {
                href = href.substr(index + wb_replay_prefix.length);
            }
            if ((href.length > 4) &&
                (href.charAt(2) == "_") &&
                (href.charAt(3) == "/")) {
                href = href.substr(4);
            }

            if (!starts_with(href, VALID_PREFIXES)) {
                href = HTTP_PREFIX + href;
            }
        }

        // remove trailing slash
        //if (ends_with(href, "/")) {
        //    href = href.substring(0, href.length - 1);
        //}

        return href;
    }

    //============================================
    // Define custom property
    function def_prop(obj, prop, set_func, get_func) {
        try {
            Object.defineProperty(obj, prop, {
                configurable: false,
//                enumerable: true,
                set: set_func,
                get: get_func
            });

            return true;
        } catch (e) {
            var info = "Can't redefine prop " + prop;
            console.warn(info);
            //f (obj && obj.tagName) {
            //    info += " on " + obj.tagName;
            //}
            //if (value != obj[prop]) {
            //    obj[prop] = value;
            //}
            return false;
        }
    }


    //============================================
    function make_parser(href) {
        href = extract_orig(href);

        var p = $wbwindow.document.createElement("a", true);
        p.href = href;
        return p;
    }


    //============================================
    function set_loc(loc, orig_href) {
        var parser = make_parser(orig_href);

        loc._orig_href = orig_href;
        loc._parser = parser;

        var href = parser.href;
        loc._hash = parser.hash;

        loc._href = href;

        loc._host = parser.host;
        loc._hostname = parser.hostname;

        if (parser.origin) {
            loc._origin = parser.origin;
        }

        loc._pathname = parser.pathname;
        loc._port = parser.port;
        //this.protocol = parser.protocol;
        loc._protocol = parser.protocol;
        loc._search = parser.search;

        if (!Object.defineProperty) {
            loc.href = href;
            loc.hash = parser.hash;

            loc.host = loc._host;
            loc.hostname = loc._hostname;
            loc.origin = loc._origin;
            loc.pathname = loc._pathname;
            loc.port = loc._port;
            loc.protocol = loc._protocol;
            loc.search = loc._search;
        }
    }


    function init_loc_override(loc_obj, orig_setter, orig_getter) {
        var make_get_loc_prop = function(prop) {
            function getter() {
                if (this._no_rewrite) {
                    return orig_getter.call(this, prop);
                }

                var curr_orig_href = orig_getter.call(this, "href");

                if (prop == "href") {
                    return extract_orig(curr_orig_href);
                }

                if (this._orig_href != curr_orig_href) {
                    set_loc(this, curr_orig_href);
                }

                var value = this["_" + prop];

                return value;
            }

            return getter;
        }

        var make_set_loc_prop = function(prop) {
            function setter(value) {
                if (this._no_rewrite) {
                    orig_setter.call(this, prop, value);
                    return;
                }

                this["_" + prop] = value;

                if (!this._parser) {
                    var href = orig_getter.call(this);
                    this._parser = make_parser(href);
                }

                try {
                    this._parser[prop] = value;
                } catch (e) {
                    console.log('Error setting ' + prop + ' = ' + value);
                }

                if (prop == "hash") {
                    value = this._parser[prop];
                } else {
                    prop = "href";
                    value = rewrite_url(this._parser.href);
                }

                orig_setter.call(this, prop, value);
            }

            return setter;
        }

        function add_loc_prop(loc, prop) {
            def_prop(loc, prop, make_set_loc_prop(prop), make_get_loc_prop(prop));
        }

        if (Object.defineProperty) {
            for (var i = 0; i < URL_PROPS.length; i++) {
               add_loc_prop(loc_obj, URL_PROPS[i]);
            }
        }
    }


    //============================================
    //Define WombatLocation

    function WombatLocation(orig_loc) {
        this._orig_loc = orig_loc;

        // Rewrite replace and assign functions
        this.replace = function(url) {
            var new_url = rewrite_url(url);
            var orig = extract_orig(new_url);
            if (orig == this.href) {
                return orig;
            }
            return this._orig_loc.replace(new_url);
        }

        this.assign = function(url) {
            var new_url = rewrite_url(url);
            var orig = extract_orig(new_url);
            if (orig == this.href) {
                return orig;
            }
            return this._orig_loc.assign(new_url);
        }

        this.reload = orig_loc.reload;
       
        this.orig_getter = function(prop) {
            return this._orig_loc[prop];
        }

        this.orig_setter = function(prop, value) {
            this._orig_loc[prop] = value;
        }

        init_loc_override(this, this.orig_setter, this.orig_getter);
        
        set_loc(this, orig_loc.href);

        this.toString = function() {
            return this.href;
        }

        // Copy any remaining properties
        for (prop in orig_loc) {
            if (this.hasOwnProperty(prop)) {
                continue;
            }

            if ((typeof orig_loc[prop]) != "function") {
                this[prop] = orig_loc[prop];
            }
        }
    }

    //============================================
    function update_location(req_href, orig_href, actual_location, wombat_loc) {
        if (!req_href) {
            return;
        }

        if (req_href == orig_href) {
            // Reset wombat loc to the unrewritten version
            //if (wombat_loc) {
            //    wombat_loc.href = extract_orig(orig_href);
            //}
            return;
        }


        var ext_orig = extract_orig(orig_href);
        var ext_req = extract_orig(req_href);

        if (!ext_orig || ext_orig == ext_req) {
            return;
        }

        var final_href = rewrite_url(req_href);

        console.log(actual_location.href + ' -> ' + final_href);

        actual_location.href = final_href;
    }

    //============================================
    function check_location_change(wombat_loc, is_top) {
        var locType = (typeof wombat_loc);

        var actual_location = (is_top ? $wbwindow.top.location : $wbwindow.location);

        // String has been assigned to location, so assign it
        if (locType == "string") {
            update_location(wombat_loc, actual_location.href, actual_location);

        } else if (locType == "object") {
            update_location(wombat_loc.href,
                            wombat_loc._orig_href,
                            actual_location);
        }
    }

    //============================================
    function check_all_locations() {
        if (wb_wombat_updating) {
            return false;
        }

        wb_wombat_updating = true;

        check_location_change($wbwindow.WB_wombat_location, false);

        // Only check top if its a different $wbwindow
        if ($wbwindow.WB_wombat_location != $wbwindow.top.WB_wombat_location) {
            check_location_change($wbwindow.top.WB_wombat_location, true);
        }

        //        lochash = $wbwindow.WB_wombat_location.hash;
        //
        //        if (lochash) {
        //            $wbwindow.location.hash = lochash;
        //
        //            //if ($wbwindow.top.update_wb_url) {
        //            //    $wbwindow.top.location.hash = lochash;
        //            //}
        //        }

        wb_wombat_updating = false;
    }

    //============================================
    function init_seeded_random(seed) {
        // Adapted from:
        // http://indiegamr.com/generate-repeatable-random-numbers-in-js/

        Math.seed = parseInt(seed);
        function seeded_random() {
            Math.seed = (Math.seed * 9301 + 49297) % 233280;
            var rnd = Math.seed / 233280;

            return rnd;
        }

        Math.random = seeded_random;
    }

    //============================================
    function override_history_func(func_name) {
        if (!$wbwindow.history) {
            return;
        }

        var orig_func = $wbwindow.history[func_name];

        if (!orig_func) {
            return;
        }

        $wbwindow.history['_orig_' + func_name] = orig_func;

        function rewritten_func(state_obj, title, url) {
            url = rewrite_url(url);

            if (url == $wbwindow.location.href) {
                return;
            }

            orig_func.call(this, state_obj, title, url);

            if ($wbwindow.__orig_parent && $wbwindow != $wbwindow.__orig_parent && $wbwindow.__orig_parent.update_wb_url) {
                $wbwindow.__orig_parent.update_wb_url($wbwindow.WB_wombat_location.href,
                                                   wb_info.timestamp,
                                                   wb_info.request_ts,
                                                   wb_info.is_live);
            }
        }

        $wbwindow.history[func_name] = rewritten_func;
        if ($wbwindow.History && $wbwindow.History.prototype) {
            $wbwindow.History.prototype[func_name] = rewritten_func;
        }

        return rewritten_func;
    }

    //============================================
    function init_ajax_rewrite() {
        if (!$wbwindow.XMLHttpRequest ||
            !$wbwindow.XMLHttpRequest.prototype ||
            !$wbwindow.XMLHttpRequest.prototype.open) {
            return;
        }

        var orig = $wbwindow.XMLHttpRequest.prototype.open;

        function open_rewritten(method, url, async, user, password) {
            if (!this._no_rewrite) {
                url = rewrite_url(url);
            }

            // defaults to true
            if (async != false) {
                async = true;
            }

            result = orig.call(this, method, url, async, user, password);
            this.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        }

        $wbwindow.XMLHttpRequest.prototype.open = open_rewritten;
    }

    //============================================
    function init_base_override()
    {
        if (!Object.defineProperty) {
            return;
        }

        // <base> element .getAttribute()
        orig_getAttribute = $wbwindow.HTMLBaseElement.prototype.getAttribute;

        $wbwindow.HTMLBaseElement.prototype.getAttribute = function(name) {
            var result = orig_getAttribute.call(this, name);
            if (name == "href") {
                result = extract_orig(result);
            }
            return result;
        }

        // <base> element .href
        var base_href_get = function() {
            return this.getAttribute("href");
        };

        def_prop($wbwindow.HTMLBaseElement.prototype, "href", undefined, base_href_get);

        // Shared baseURI
        var orig_getter = $wbwindow.document.__lookupGetter__("baseURI");

        var get_baseURI = function() {
            var res = orig_getter.call(this);
            return extract_orig(res);
        }

        def_prop($wbwindow.HTMLElement.prototype, "baseURI", undefined, get_baseURI);
        def_prop($wbwindow.HTMLDocument.prototype, "baseURI", undefined, get_baseURI);
    }

    //============================================
    function init_setAttribute_override()
    {
        if (!$wbwindow.Element ||
            !$wbwindow.Element.prototype ||
            !$wbwindow.Element.prototype.setAttribute) {
            return;
        }

        var orig_setAttribute = $wbwindow.Element.prototype.setAttribute;
        wb_setAttribute = orig_setAttribute;

        $wbwindow.Element.prototype._orig_setAttribute = orig_setAttribute;

        $wbwindow.Element.prototype.setAttribute = function(name, value) {
            if (name) {
                var lowername = name.toLowerCase();
                if (equals_any(lowername, REWRITE_ATTRS) && typeof(value) == "string") {
                    if (!this._no_rewrite) {
                        var old_value = value;
                        var new_value = rewrite_url(value);
                        if (new_value != old_value) {
                            this._no_rewrite = true;
                        }
                        value = new_value;
                    }
                }
            }
            orig_setAttribute.call(this, name, value);
        };
    }

    //============================================
    function init_getAttribute_override()
    {
        if (!$wbwindow.Element ||
            !$wbwindow.Element.prototype ||
            !$wbwindow.Element.prototype.setAttribute) {
            return;
        }

        var orig_getAttribute = $wbwindow.Element.prototype.getAttribute;
        wb_getAttribute = orig_getAttribute;

        $wbwindow.Element.prototype.getAttribute = function(name) {
            var result = orig_getAttribute.call(this, name);

            if (equals_any(name.toLowerCase(), REWRITE_ATTRS)) {
                result = extract_orig(result);
            } else if (starts_with(name, "data-") && starts_with(result, VALID_PREFIXES)) {
                result = extract_orig(result);
            }

            return result;
        }

    }

    //============================================
    function init_createElement_override()
    {
        if (!$wbwindow.document.createElement ||
            !$wbwindow.Document.prototype.createElement) {
            return;
        }

        var orig_createElement = $wbwindow.document.createElement;

        var createElement_override = function(tagName, skip)
        {
            var created = orig_createElement.call(this, tagName);
            if (!created) {
                return created;
            }
            if (skip) {
                created._no_rewrite = true;
            }
            // else {
            //    add_attr_overrides(tagName.toUpperCase(), created);
            //}

            return created;
        }

        $wbwindow.Document.prototype.createElement = createElement_override;
        $wbwindow.document.createElement = createElement_override;
    }

    //============================================
    function init_createElementNS_fix()
    {
        if (!$wbwindow.document.createElementNS ||
            !$wbwindow.Document.prototype.createElementNS) {
            return;
        }

        var orig_createElementNS = $wbwindow.document.createElementNS;

        var createElementNS_fix = function(namespaceURI, qualifiedName)
        {
            namespaceURI = extract_orig(namespaceURI);
            return orig_createElementNS.call(this, namespaceURI, qualifiedName);
        }

        $wbwindow.Document.prototype.createElementNS = createElementNS_fix;
        $wbwindow.document.createElementNS = createElementNS_fix;
    }

    //============================================
    //function init_image_override() {
    //    $wbwindow.__Image = $wbwindow.Image;
    //    $wbwindow.Image = function (Image) {
    //        return function (width, height) {
    //            var image = new Image(width, height);
    //            override_attr(image, "src");
    //            return image;
    //        }
    //    }($wbwindow.Image);
    //}

    //============================================
    function init_date_override(timestamp) {
        timestamp = parseInt(timestamp) * 1000;
        //var timezone = new Date().getTimezoneOffset() * 60 * 1000;
        // Already UTC!
        var timezone = 0;
        var timediff = $wbwindow.Date.now() - (timestamp - timezone);

        if ($wbwindow.__wb_Date_now) {
            return;
        }

        var orig_date = $wbwindow.Date;

        var orig_utc = $wbwindow.Date.UTC;
        var orig_parse = $wbwindow.Date.parse;
        var orig_now = $wbwindow.Date.now;

        $wbwindow.__wb_Date_now = orig_now;

        $wbwindow.Date = function (Date) {
            return function (A, B, C, D, E, F, G) {
                // Apply doesn't work for constructors and Date doesn't
                // seem to like undefined args, so must explicitly
                // call constructor for each possible args 0..7
                if (A === undefined) {
                    return new Date(orig_now() - timediff);
                } else if (B === undefined) {
                    return new Date(A);
                } else if (C === undefined) {
                    return new Date(A, B);
                } else if (D === undefined) {
                    return new Date(A, B, C);
                } else if (E === undefined) {
                    return new Date(A, B, C, D);
                } else if (F === undefined) {
                    return new Date(A, B, C, D, E);
                } else if (G === undefined) {
                    return new Date(A, B, C, D, E, F);
                } else {
                    return new Date(A, B, C, D, E, F, G);
                }
            }
        }($wbwindow.Date);

        $wbwindow.Date.prototype = orig_date.prototype;

        $wbwindow.Date.now = function() {
            return orig_now() - timediff;
        }

        $wbwindow.Date.UTC = orig_utc;
        $wbwindow.Date.parse = orig_parse;
    }

    //============================================
    function init_worker_override() {
        if (!$wbwindow.Worker) {
            return;
        }

        // for now, disabling workers until override of worker content can be supported
        // hopefully, pages depending on workers will have a fallback
        $wbwindow.Worker = undefined;
    }


    //============================================
    function init_mutation_obs($wbwindow) {
        if (!$wbwindow.MutationObserver) {
            return;
        }

        var m = new MutationObserver(function(records, observer)
                                     {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type == "attributes" && r.attributeName == "style") {
                    var style = r.target.style.cssText;
                    if (style.indexOf("url(") > 0) {
                        var new_style = rewrite_style(style);
                        if (new_style != style) {
                            r.target.style.cssText = new_style;
                        }
                    }
                }
            }
        });

        m.observe($wbwindow.document.documentElement, {
            childList: false,
            attributes: true,
            subtree: true,
            //attributeOldValue: true,
            attributeFilter: ["style"]});
    }

    //============================================
    function init_href_src_obs($wbwindow)
    {
        if (!$wbwindow.MutationObserver) {
            return;
        }

        var m = new MutationObserver(function(records, observer)
                                     {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type == "attributes") {
                    //var curr = wb_getAttribute(r.target, r.attributeName);
                    var curr = r.target.getAttribute(r.attributeName);
                    var new_url = rewrite_url(curr);
                    if (curr != new_url) {
                        wb_setAttribute.call(r.target, r.attributeName, new_url);
                    }
                }
            }
        });

        m.observe($wbwindow.document.documentElement, {
            childList: false,
            attributes: true,
            subtree: true,
            //attributeOldValue: true,
            attributeFilter: ["src", "href"]});

    }


    //============================================
    function init_iframe_insert_obs(root)
    {
        if (!$wbwindow.MutationObserver) {
            return;
        }

        var m = new MutationObserver(function(records, observer)
        {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type == "childList") {
                    for (var j = 0; j < r.addedNodes.length; j++) {
                        if (r.addedNodes[j].tagName == "IFRAME") {
                            init_iframe_wombat(r.addedNodes[j]);
                        }
                    }
                }
            }
        });

        m.observe(root, {
            childList: true,
            subtree: true,
        });
    }

    //============================================
    function rewrite_attr(elem, name, func) {
        if (!elem || !elem.getAttribute) {
            return;
        }

        if (elem._no_rewrite) {
            return;
        }

        // already overwritten
        if (elem["_" + name]) {
            return;
        }

        var value = wb_getAttribute.call(elem, name);

        if (!value || starts_with(value, "javascript:")) {
            return;
        }

        var new_value = value;

        if (func) {
            new_value = func(value);
        }

        if (value != new_value) {
            wb_setAttribute.call(elem, name, new_value);
        }
    }

    //============================================
    function rewrite_style(value)
    {
        STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/g;

        function style_replacer(match, n1, n2, n3, offset, string) {
            return n1 + rewrite_url(n2) + n3;
        }

        return value.replace(STYLE_REGEX, style_replacer);
    }

    //============================================
    function rewrite_elem(elem)
    {
        rewrite_attr(elem, "src", rewrite_url);
        rewrite_attr(elem, "href", rewrite_url);
        rewrite_attr(elem, "style", rewrite_style);

        if (elem && elem.getAttribute && elem.getAttribute("crossorigin")) {
            elem.removeAttribute("crossorigin");
        }
    }

    //============================================
    function rewrite_html(string) {
        if (!string) {
            return string;
        }

        var inner_doc = new DOMParser().parseFromString(string, "text/html");

        if (!inner_doc) {
            return string;
        }

        string = string.toString();

        var new_html = "";
        var head = "";
        var body = "";

        if (inner_doc.head.innerHTML) {
            var elems = inner_doc.head.children;

            for (var i = 0; i < elems.length; i++) {
                // Call orig write to ensure same execution order and placement
                rewrite_elem(elems[i]);
            }
            head += inner_doc.head.innerHTML;
        }

        if (inner_doc.body.innerHTML) {
            var elems = inner_doc.body.children;

            for (var i = 0; i < elems.length; i++) {
                // Call orig write to ensure same execution order and placement
                rewrite_elem(elems[i]);
            }
            body += inner_doc.body.innerHTML;
        }

        if (string && string.indexOf("<head") >= 0) {
            new_html += "<head>" + head + "</head>";
        } else {
            new_html += head;
        }

        if (string && string.indexOf("<body") >= 0) {
            new_html += "<body>" + body + "</body>";
        } else {
            new_html += body;
        }

        if (string && string.indexOf("<html") >= 0) {
            new_html = "<html>" + new_html + "</html>";
        }

        return new_html;
    }

    //============================================
    function add_attr_overrides(tagName, created)
    {
        if (!created || created._src != undefined || created._href != undefined) {
            return;
        }

        if (equals_any(tagName, SRC_TAGS)) {
            override_attr(created, "src");
        } else if (equals_any(tagName, HREF_TAGS)) {
            override_attr(created, "href");
        }
    }

    //============================================
    function get_orig_getter(obj, prop) {
        var orig_getter;

        if (obj.__lookupGetter__) {
            orig_getter = obj.__lookupGetter__(prop);
        }

        if (!orig_getter && Object.getOwnPropertyDescriptor) {
            var props = Object.getOwnPropertyDescriptor(obj, prop);
            if (props) {
                orig_getter = props.get;
            }
        }

        return orig_getter;
    }

    //============================================
    function get_orig_setter(obj, prop) {
        var orig_setter;

        if (obj.__lookupSetter__) {
            orig_setter = obj.__lookupSetter__(prop);
        }

        if (!orig_setter && Object.getOwnPropertyDescriptor) {
            var props = Object.getOwnPropertyDescriptor(obj, prop);
            if (props) {
                orig_setter = props.set;
            }
        }

        return orig_setter;
    }

    //============================================
    function override_attr(obj, attr) {
        var orig_getter = get_orig_getter(obj, attr);
        var orig_setter = get_orig_setter(obj, attr);

        var setter = undefined;
        var getter = undefined;

        if (orig_setter) {
            setter = function(orig) {
                var val = rewrite_url(orig);
                //wb_setAttribute.call(this, attr, val);
                orig_setter.call(this, val);
                return val;
            }
        }

        if (orig_getter) {
            getter = function(val) {
                var res = orig_getter.call(this);
                res = extract_orig(res);
                return res;
            }
        }

        //var curr_src = obj.getAttribute(attr);
        def_prop(obj, attr, setter, getter);
    }


    //============================================
    function init_attr_overrides($wbwindow) {
        override_attr($wbwindow.HTMLLinkElement.prototype, "href");
        override_attr($wbwindow.HTMLImageElement.prototype, "src");
        override_attr($wbwindow.HTMLIFrameElement.prototype, "src");
        override_attr($wbwindow.HTMLScriptElement.prototype, "src");
        override_attr($wbwindow.HTMLMediaElement.prototype, "src");
        override_attr($wbwindow.HTMLMediaElement.prototype, "poster");
        override_attr($wbwindow.HTMLSourceElement.prototype, "src");
        override_attr($wbwindow.HTMLInputElement.prototype, "src");
        override_attr($wbwindow.HTMLEmbedElement.prototype, "src");
        
        //override_attr($wbwindow.HTMLAnchorElement.prototype, "href");
        //return;
        var anchor_orig = {}

        function save_prop(prop) {
            anchor_orig["get_" + prop] = get_orig_getter($wbwindow.HTMLAnchorElement.prototype, prop);
            anchor_orig["set_" + prop] = get_orig_setter($wbwindow.HTMLAnchorElement.prototype, prop);
        }

        for (var i = 0; i < URL_PROPS.length; i++) {
            save_prop(URL_PROPS[i]);
        } 

        var anchor_setter = function(prop, value) {
            var func = anchor_orig["set_" + prop];
            if (func) {
                return func.call(this, value);
            } else {
                return "";
            }
        }

        var anchor_getter = function(prop) {
            var func = anchor_orig["get_" + prop];
            if (func) {
                return func.call(this);
            } else {
                return "";
            }
        }

        init_loc_override($wbwindow.HTMLAnchorElement.prototype, anchor_setter, anchor_getter);
    }


    //============================================
    function override_innerHTML() {
        if (!$wbwindow.DOMParser ||
            !$wbwindow.HTMLElement ||
            !$wbwindow.HTMLElement.prototype) {
            return;
        }

        var obj = $wbwindow.HTMLElement.prototype;
        var prop = "innerHTML";

        var orig_getter = get_orig_getter(obj, prop);
        var orig_setter = get_orig_setter(obj, prop);

        if (!orig_setter) {
            return;
        }

        var setter = function(orig) {
            var res = orig;
            if (!this._no_rewrite) {
                //init_iframe_insert_obs(this);
                res = rewrite_html(orig);
            }
            orig_setter.call(this, res);
        }

        def_prop(obj, prop, setter, orig_getter);
    }


    //============================================
    function override_iframe_content_access(prop)
    {
        if (!$wbwindow.HTMLIFrameElement ||
            !$wbwindow.HTMLIFrameElement.prototype) {
            return;
        }

        var obj = $wbwindow.HTMLIFrameElement.prototype;

        var orig_getter = get_orig_getter(obj, prop);
        var orig_setter = get_orig_setter(obj, prop);

        if (!orig_getter) {
            return;
        }

        var getter = function() {
            init_iframe_wombat(this);
            return orig_getter.call(this);
        };
        
        def_prop(obj, prop, orig_setter, getter);
        obj["_get_" + prop] = orig_getter;
    }

    //============================================
    function init_insertAdjacentHTML_override()
    {
        if (!$wbwindow.Element ||
            !$wbwindow.Element.prototype ||
            !$wbwindow.Element.prototype.insertAdjacentHTML) {
            return;
        }

        var orig_insertAdjacentHTML = $wbwindow.Element.prototype.insertAdjacentHTML;

        var insertAdjacent_override = function(position, text)
        {
            if (!this._no_rewrite) {
                // inserting adjacent, so must observe parent
                //if (this.parentElement) {
                //    init_iframe_insert_obs(this.parentElement);
                //}
                text = rewrite_html(text);
            }
 
            return orig_insertAdjacentHTML.call(this, position, text);
        }

        $wbwindow.Element.prototype.insertAdjacentHTML = insertAdjacent_override;
    }



    //============================================
    function init_wombat_loc(win) {

        if (!win || (win.WB_wombat_location && win.document.WB_wombat_location)) {
            return;
        }

        // Location
        var wombat_location = new WombatLocation(win.location);

        if (Object.defineProperty) {

            var setter = function(value) {
                if (this._WB_wombat_location) {
                    this._WB_wombat_location.href = value;
                } else {
                    this.location = value;
                }
            }

            var getter = function() {
                if (this._WB_wombat_location) {
                    return this._WB_wombat_location;
                } else {
                    return this.location;
                }
            }

            def_prop(win.Object.prototype, "WB_wombat_location", setter, getter);

            init_proto_pm_origin(win);

            win._WB_wombat_location = wombat_location;
            win.document._WB_wombat_location = wombat_location;
        } else {
            win.WB_wombat_location = wombat_location;
            win.document.WB_wombat_location = wombat_location;

            // Check quickly after page load
            setTimeout(check_all_locations, 500);

            // Check periodically every few seconds
            setInterval(check_all_locations, 500);
        }
    }

    //============================================
    function rewrite_children(child) {
        var desc;

        if (child.querySelectorAll) {
            desc = child.querySelectorAll("[href], [src]");
        }

        if (desc) {
            for (var i = 0; i < desc.length; i++) {
                rewrite_elem(desc[i]);
            }
        }
    }


    //============================================
    function init_dom_override() {
        if (!$wbwindow.Node || !$wbwindow.Node.prototype) {
            return;
        }

        function replace_dom_func(funcname) {
            var orig = $wbwindow.Node.prototype[funcname];

            $wbwindow.Node.prototype[funcname] = function() {
                var child = arguments[0];

                if (child) {
                    rewrite_elem(child);

                    // if fragment, rewrite children before adding
                    //if (child instanceof DocumentFragment) {
                    //   rewrite_children(child);
                    //}
                }

                var created = orig.apply(this, arguments);

                if (created && created.tagName == "IFRAME") {
                    init_iframe_wombat(created);
                }

                return created;
            }
        }

        replace_dom_func("appendChild");
        replace_dom_func("insertBefore");
        replace_dom_func("replaceChild");
    }


    function init_proto_pm_origin(win) {
        function pm_origin(origin_window) {
            this.__WB_pm_origin = (origin_window && origin_window.WB_wombat_location && origin_window.WB_wombat_location.origin);
            //console.log("Origin " + this.__WB_pm_origin);
            return this;
        }

        try {
            win.Object.defineProperty(win.Object.prototype, "__WB_pmw", {value: pm_origin, configurable: false, enumerable: false});
        } catch(e) {
        }
    }

    //============================================
    function init_postmessage_override($wbwindow)
    {
        if (!$wbwindow.postMessage || $wbwindow.__orig_postMessage) {
            return;
        }

        var orig = $wbwindow.postMessage;
        
        $wbwindow.__orig_postMessage = orig;

        var postmessage_rewritten = function(message, targetOrigin, transfer) {

            var from = undefined;
            
            if (window.__WB_pm_origin) {
                from = window.__WB_pm_origin;
                window.__WB_pm_origin = undefined;
            } else {
                from = window.WB_wombat_location.origin;
            }

            var to = targetOrigin;
            
            if (to == this.location.origin) {
                to = "*";
            } else {
                var to_host = to.split("//", 2);
                if (to_host.length == 2) {
                    to = to_host[1];
                }
            }

            var new_message = {"from": from,
                               "to_host": to,
                               "message": message};

            if (targetOrigin != "*") {
                targetOrigin = this.location.origin;
                //targetOrigin = "*";
            }

            //console.log("Sending " + from + " -> " + to + " (" + targetOrigin + ") " + message);
            
            return orig.call(this, new_message, targetOrigin, transfer);
        }

        $wbwindow.postMessage = postmessage_rewritten;

        $wbwindow.Window.prototype.postMessage = postmessage_rewritten;

/*
        for (var i = 0; i < $wbwindow.frames.length; i++) {
            try {
                //init_postmessage_override($wbwindow.frames[i]);
                $wbwindow.frames[i].postMessage = postmessage_rewritten;
            } catch (e) {
                console.log(e);
            }
        }
*/
        $wbwindow._orig_addEventListener = $wbwindow.addEventListener;

        var addEventListener_rewritten = function(type, listener, useCapture) {
            if (type == "message") {
                var orig_listener = listener;
                var new_listener = function(event) {
                    var ne = event;

                    if (event.data.from && event.data.message) {

                        if (event.data.to_host != "*" && this.WB_wombat_location && event.data.to_host != this.WB_wombat_location.host) {
                            console.log("Skipping " + this.WB_wombat_location.host + " not " + event.data.to_host);
                            return;
                        }

                        ne = new MessageEvent("message",
                                              {"bubbles": event.bubbles,
                                               "cancelable": event.cancelable,
                                               "data": event.data.message,
                                               "origin": event.data.from,
                                               "lastEventId": event.lastEventId,
                                               "source": event.source,
                                               "ports": event.ports});

                    }
 
                    return orig_listener(ne);
                }
                listener = new_listener;
            }

            return _orig_addEventListener.call(this, type, listener, useCapture);
        }
 
        $wbwindow.addEventListener = addEventListener_rewritten;
        //$wbwindow.Window.prototype.addEventListener = addEventListener_rewritten;
    }

    //============================================
    function init_open_override()
    {
        if (!$wbwindow.Window.prototype.open) {
            return;
        }

        var orig = $wbwindow.Window.prototype.open;

        var open_rewritten = function(strUrl, strWindowName, strWindowFeatures) {
            strUrl = rewrite_url(strUrl);
            return orig.call(this, strUrl, strWindowName, strWindowFeatures);
        }

        $wbwindow.open = open_rewritten;
        $wbwindow.Window.prototype.open = open_rewritten;

        for (var i = 0; i < $wbwindow.frames.length; i++) {
            try {
                $wbwindow.frames[i].open = open_rewritten;
            } catch (e) {
                console.log(e);
            }
        }
    }

    //============================================
    function init_cookies_override($wbwindow)
    {
        var cookie_path_regex = /\bPath=\'?\"?([^;'"\s]+)/i;
        var cookie_domain_regex = /\b(Domain=)([^;'"\s]+)/i;
        var cookie_expires_regex = /\bExpires=([^;'"]+)/ig;

        var orig_get_cookie = get_orig_getter($wbwindow.document, "cookie");
        var orig_set_cookie = get_orig_setter($wbwindow.document, "cookie");


        function rewrite_cookie(cookie) {
            var matched = cookie.match(cookie_path_regex);

            // rewrite path
            if (matched) {
                var rewritten = rewrite_url(matched[1]);

                if (rewritten.indexOf(wb_curr_host) == 0) {
                    rewritten = rewritten.substring(wb_curr_host.length);
                }

                cookie = cookie.replace(matched[1], rewritten);
            }

            // if no subdomain, eg. "localhost", just remove domain altogether
            if ($wbwindow.location.hostname.indexOf(".") >= 0) {
                cookie = cookie.replace(cookie_domain_regex, "$`$1." + $wbwindow.location.hostname + "$'");
            } else {
                cookie = cookie.replace(cookie_domain_regex, "$`$'");
            }

            // rewrite secure, if needed
            if ($wbwindow.location.protocol != "https:") {
                cookie = cookie.replace("secure", "");
            }

            //console.log(cookie);

            return cookie;
        }


        var set_cookie = function(value) {
            if (!value) {
                return;
            }

            value = value.replace(cookie_expires_regex, "");

            var cookies = value.split(",");

            for (var i = 0; i < cookies.length; i++) {
                cookies[i] = rewrite_cookie(cookies[i]);
            }

            value = cookies.join(",")

            return orig_set_cookie.call(this, value);
        }

        def_prop($wbwindow.document, "cookie", set_cookie, orig_get_cookie);
    }

    //============================================
    function init_write_override()
    {
        if (!$wbwindow.DOMParser) {
            return;
        }

        var check_wombat = function(win) {
            if (win && !win._wb_wombat) {
                win._WBWombat = wombat_internal(win);
                win._wb_wombat = new win._WBWombat(wb_info);
            }
        }

        // Write
        var orig_doc_write = $wbwindow.document.write;

        var new_write = function(string) {
            new_buff = rewrite_html(string);
            var res = orig_doc_write.call(this, new_buff);
            check_wombat(this.defaultView);
            return res;
        }

        $wbwindow.document.write = new_write;
        $wbwindow.Document.prototype.write = new_write;

        // Open
        var orig_doc_open = $wbwindow.document.open;

        var new_open = function() {
            var res = orig_doc_open.call(this);
            check_wombat(this.defaultView);
            return res;
        }

        $wbwindow.document.open = new_open;
        $wbwindow.Document.prototype.open = new_open;
    }

    //============================================
    function init_iframe_wombat(iframe) {
        /*
        if (iframe._wombat) {
            return;
        }

        iframe._wombat = true;
        */

        var win;

        if (iframe._get_contentWindow) {
            win = iframe._get_contentWindow.call(iframe);
        } else {
            win = iframe.contentWindow;
        }

        try {
            if (!win || win == $wbwindow || win._skip_wombat || win._wb_wombat) {
                return iframe;
            }
        } catch (e) {
            console.log(e);
        }

        //var src = iframe.src;
        var src = wb_getAttribute.call(iframe, "src");
        
        if (!src || src == "" || src == "about:blank" || src.indexOf("javascript:") >= 0) {
            win._WBWombat = wombat_internal(win);
            win._wb_wombat = new win._WBWombat(wb_info);
        } else {
            // These should get overriden when content is loaded, but just in case...
            //win._WB_wombat_location = win.location;
            //win.document.WB_wombat_location = win.document.location;
            //win._WB_wombat_top = $wbwindow.WB_wombat_top;

            init_proto_pm_origin(win);
            //init_postmessage_override(win);
        }
    }


    //============================================
    function init_doc_overrides($wbwindow) {
        if (!Object.defineProperty) {
            return;
        }

        if ($wbwindow.document._wb_override) {
            return;
        }

        var orig_referrer = extract_orig($wbwindow.document.referrer);


        def_prop($wbwindow.document, "domain", undefined, function() { return wbinfo.wombat_host });

        def_prop($wbwindow.document, "referrer", undefined, function() { return orig_referrer; });


        // Cookies
        init_cookies_override($wbwindow);

        // Init mutation observer (for style only)
        init_mutation_obs($wbwindow);

        // override href and src attrs
        init_attr_overrides($wbwindow);


        // Attr observers
        //if (!wb_opts.skip_attr_observers) {
           // init_href_src_obs($wbwindow);
        //}

        $wbwindow.document._wb_override = true;
    }


    //============================================
    function wombat_init(wbinfo) {
        wb_info = wbinfo;

        wb_replay_prefix = wbinfo.prefix;
        if (wb_replay_prefix.indexOf($wbwindow.top.location.origin) == 0) {
            wb_coll_prefix = wb_replay_prefix.substring($wbwindow.top.location.origin.length + 1);
        } else {
            wb_coll_prefix = wb_replay_prefix;
        }
        wb_coll_prefix_check = wb_coll_prefix;

        wbinfo.wombat_opts = wbinfo.wombat_opts || {};
        wb_opts = wbinfo.wombat_opts;

        wb_curr_host = $wbwindow.location.protocol + "//" + $wbwindow.location.host;

        if (wb_replay_prefix) {
            var ts_mod;

            // if live, don't add the timestamp
            if (wbinfo.is_live) {
                ts_mod = wbinfo.mod;
            } else {
                ts_mod = wbinfo.wombat_ts + wbinfo.mod;
            }

            if (ts_mod != "") {
                ts_mod += "/";
            }

            wb_replay_date_prefix = wb_replay_prefix + ts_mod;
            wb_coll_prefix += ts_mod;

            if (!wbinfo.is_live && wbinfo.wombat_ts.length > 0) {
                wb_capture_date_part = "/" + wbinfo.wombat_ts + "/";
            } else {
                wb_capture_date_part = "";
            }

            wb_orig_scheme = wbinfo.wombat_scheme + '://';

            wb_orig_origin = wb_orig_scheme + wbinfo.wombat_host;

            init_bad_prefixes(wb_replay_prefix);
        }

        init_wombat_loc($wbwindow);

        var is_framed = ($wbwindow.top.wbinfo && $wbwindow.top.wbinfo.is_frame);

        function find_next_top(nextwin) {
            while ((nextwin.parent != nextwin) && (nextwin.parent != nextwin.top)) {
                nextwin = nextwin.parent;
            }
            return nextwin;
        }

        if ($wbwindow.location != $wbwindow.top.location) {
            $wbwindow.__orig_parent = $wbwindow.parent;
            if (is_framed) {
                $wbwindow.top._WB_wombat_location = $wbwindow._WB_wombat_location;

                $wbwindow.WB_wombat_top = find_next_top($wbwindow);

                if ($wbwindow.parent == $wbwindow.top) {
                    $wbwindow.parent = $wbwindow;

                    // Disable frameElement also as this should be top frame
                    if (Object.defineProperty) {
                        Object.defineProperty($wbwindow, "frameElement", {value: undefined, configurable: false});
                    }
                }
            } else {
                $wbwindow.top._WB_wombat_location = new WombatLocation($wbwindow.top.location);
                $wbwindow.WB_wombat_top = $wbwindow.top;
            }
        } else {
            $wbwindow.WB_wombat_top = $wbwindow.top;
        }

        //if ($wbwindow.opener) {
        //    $wbwindow.opener.WB_wombat_location = copy_location_obj($wbwindow.opener.location);
        //}

        // Domain
        //$wbwindow.document.WB_wombat_domain = wbinfo.wombat_host;
        //$wbwindow.document.WB_wombat_referrer = extract_orig($wbwindow.document.referrer);

        init_doc_overrides($wbwindow, wb_opts);

        // History
        override_history_func("pushState");
        override_history_func("replaceState");

        // open
        init_open_override();

        // postMessage
        // OPT skip
        if (!wb_opts.skip_postmessage) {
            init_postmessage_override($wbwindow);
        }

        // write
        init_write_override();

        // Ajax
        init_ajax_rewrite();

        if (!wb_opts.skip_disable_worker) {
            //init_worker_override();
        }

        // innerHTML can be overriden on prototype!
        override_innerHTML();


        // init insertAdjacentHTML() override
        init_insertAdjacentHTML_override();

        // iframe.contentWindow and iframe.contentDocument overrides to 
        // ensure wombat is inited on the iframe $wbwindow!
        override_iframe_content_access("contentWindow");
        override_iframe_content_access("contentDocument");

        // base override
        init_base_override();

        // setAttribute
        if (!wb_opts.skip_setAttribute) {
            init_setAttribute_override();
            init_getAttribute_override();
        }

        // createElement attr override
        if (!wb_opts.skip_createElement) {
            init_createElement_override();
        }

        // ensure namespace urls are NOT rewritten
        init_createElementNS_fix();

        // Image
        //init_image_override();

        // DOM
        // OPT skip
        if (!wb_opts.skip_dom) {
            init_dom_override();
        }

        // Random
        init_seeded_random(wbinfo.wombat_sec);

        // Date
        init_date_override(wbinfo.wombat_sec);

        // expose functions
        this.extract_orig = extract_orig;
        this.rewrite_url = rewrite_url;
        this.watch_elem = watch_elem;
    }

    // Utility functions used by rewriting rules
    function watch_elem(elem, func)
    {
        if (!$wbwindow.MutationObserver) {
            return false;
        }

        var m = new MutationObserver(function(records, observer) {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type == "childList") {
                    for (var j = 0; j < r.addedNodes.length; j++) {
                        func(r.addedNodes[j]);
                    }
                }
            }
        });

        m.observe(elem, {
            childList: true,
            subtree: true,
        });
    };

    return wombat_init;
};

return wombat_internal(window);
})();

window._WBWombat = _WBWombat;
