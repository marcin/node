(function (process) {

global = this;
global.process = process;
global.global = global;
global.GLOBAL = global;
global.root = global;

/** deprecation errors ************************************************/

function removed (reason) {
  return function () {
    throw new Error(reason)
  }
}

process.debug = removed("process.debug() has moved. Use require('sys') to bring it back.");
process.error = removed("process.error() has moved. Use require('sys') to bring it back.");
process.watchFile = removed("process.watchFile() has moved to fs.watchFile()");
process.unwatchFile = removed("process.unwatchFile() has moved to fs.unwatchFile()");
process.mixin = removed('process.mixin() has been removed.');
process.createChildProcess = removed("childProcess API has changed. See doc/api.txt.");
process.inherits = removed("process.inherits() has moved to sys.inherits.");
process._byteLength = removed("process._byteLength() has moved to Buffer.byteLength");

process.assert = function (x, msg) {
  if (!x) throw new Error(msg || "assertion error");
};

var writeError = process.binding('stdio').writeError;

// nextTick()

var nextTickQueue = [];

process._tickCallback = function () {
  var l = nextTickQueue.length;
  if (l === 0) return;

  try {
    for (var i = 0; i < l; i++) {
      nextTickQueue[i]();
    }
  }
  catch(e) {
    nextTickQueue.splice(0, i+1);
    if (i+1 < l) {
      process._needTickCallback();
    }
    throw e;
  }

  nextTickQueue.splice(0, l);
};

process.nextTick = function (callback) {
  nextTickQueue.push(callback);
  process._needTickCallback();
};

// Native module system

var internalModuleCache = {},
  // This contains the source code for the files in lib/
  // Like, natives.fs is the contents of lib/fs.js
  nativeSource = process.binding('natives');

function requireNative (id) {
  if (internalModuleCache[id]) return internalModuleCache[id].exports;
  if (!nativeSource[id]) throw new Error('No such native module ' + id);

  var m = { id: id, exports: {} };
  internalModuleCache[id] = m;

  // Compile the native module. Create wrapper function
  var wrapper = "(function (exports, require, module) { "
              + nativeSource[id]
              + "\n});";

  var compiledWrapper = process.compile(wrapper, id);
  compiledWrapper.apply(m.exports, [m.exports, requireNative, m]);

  m.loaded = true;

  return m.exports;
}


// Load events module in order to access prototype elements on process like
// process.addListener.
var events = requireNative('events');

var constants; // lazy loaded.

// Signal Handlers
(function() {
  var signalWatchers = {};
  var addListener = process.addListener;
  var removeListener = process.removeListener;

  function isSignal (event) {
    if (!constants) constants = process.binding("constants");
    return event.slice(0, 3) === 'SIG' && constants[event];
  }

  // Wrap addListener for the special signal types
  process.on = process.addListener = function (type, listener) {
    var ret = addListener.apply(this, arguments);
    if (isSignal(type)) {
      if (!signalWatchers.hasOwnProperty(type)) {
        if (!constants) constants = process.binding("constants");
        var b = process.binding('signal_watcher');
        var w = new b.SignalWatcher(constants[type]);
        w.callback = function () { process.emit(type); };
        signalWatchers[type] = w;
        w.start();

      } else if (this.listeners(type).length === 1) {
        signalWatchers[event].start();
      }
    }

    return ret;
  };

  process.removeListener = function (type, listener) {
    var ret = removeListener.apply(this, arguments);
    if (isSignal(type)) {
      process.assert(signalWatchers.hasOwnProperty(type));

      if (this.listeners(type).length === 0) {
        signalWatchers[type].stop();
      }
    }

    return ret;
  };
})();

// Timers
function addTimerListener (callback) {
  var timer = this;
  // Special case the no param case to avoid the extra object creation.
  if (arguments.length > 2) {
    var args = Array.prototype.slice.call(arguments, 2);
    timer.callback = function () { callback.apply(timer, args); };
  } else {
    timer.callback = callback;
  }
}

var Timer; // lazy load

global.setTimeout = function (callback, after) {
  if (!Timer) Timer = process.binding("timer").Timer;
  var timer = new Timer();
  addTimerListener.apply(timer, arguments);
  timer.start(after, 0);
  return timer;
};

global.setInterval = function (callback, repeat) {
  if (!Timer) Timer = process.binding("timer").Timer;
  var timer = new Timer();
  addTimerListener.apply(timer, arguments);
  timer.start(repeat, repeat ? repeat : 1);
  return timer;
};

global.clearTimeout = function (timer) {
  if (!Timer) Timer = process.binding("timer").Timer;
  if (timer instanceof Timer) {
    timer.stop();
  }
};

global.clearInterval = global.clearTimeout;


var stdout;
process.__defineGetter__('stdout', function () {
  if (stdout) return stdout;

  var binding = process.binding('stdio'),
      net = requireNative('net'),
      fs = requireNative('fs'),
      fd = binding.stdoutFD;

  if (binding.isStdoutBlocking()) {
    stdout = new fs.WriteStream(null, {fd: fd});
  } else {
    stdout = new net.Stream(fd);
    // FIXME Should probably have an option in net.Stream to create a stream from
    // an existing fd which is writable only. But for now we'll just add
    // this hack and set the `readable` member to false.
    // Test: ./node test/fixtures/echo.js < /etc/passwd
    stdout.readable = false;
  }

  return stdout;
});

var stdin;
process.openStdin = function () {
  if (stdin) return stdin;

  var binding = process.binding('stdio'),
      net = requireNative('net'),
      fs = requireNative('fs'),
      fd = binding.openStdin();

  if (binding.isStdinBlocking()) {
    stdin = new fs.ReadStream(null, {fd: fd});
  } else {
    stdin = new net.Stream(fd);
    stdin.readable = true;
  }

  stdin.resume();

  return stdin;
};


// console object
var formatRegExp = /%[sdj]/g;
function format (f) {
  if (typeof f !== 'string') {
    var objects = [], sys = requireNative('sys');
    for (var i = 0; i < arguments.length; i++) {
      objects.push(sys.inspect(arguments[i]));
    }
    return objects.join(' ');
  }


  var i = 1;
  var args = arguments;
  var str = String(f).replace(formatRegExp, function (x) {
    switch (x) {
      case '%s': return args[i++];
      case '%d': return +args[i++];
      case '%j': return JSON.stringify(args[i++]);
      default:
        return x;
    }
  });
  for (var len = args.length; i < len; ++i) {
    str += ' ' + args[i];
  }
  return str;
}

global.console = {};

global.console.log = function () {
  process.stdout.write(format.apply(this, arguments) + '\n');
};

global.console.info = global.console.log;

global.console.warn = function () {
  writeError(format.apply(this, arguments) + '\n');
};

global.console.error = global.console.warn;

global.console.dir = function(object){
  var sys = requireNative('sys');
  process.stdout.write(sys.inspect(object) + '\n');
};

var times = {};
global.console.time = function(label){
  times[label] = Date.now();
};

global.console.timeEnd = function(label){
  var duration = Date.now() - times[label];
  global.console.log('%s: %dms', label, duration);
};

global.console.trace = function(label){
  // TODO probably can to do this better with V8's debug object once that is
  // exposed.
  var err = new Error;
  err.name = 'Trace';
  err.message = label || '';
  Error.captureStackTrace(err, arguments.callee);
  console.error(err.stack);
};

global.console.assert = function(expression){
  if(!expression){
    var arr = Array.prototype.slice.call(arguments, 1);
    process.assert(false, format.apply(this, arr));
  }
}

global.Buffer = requireNative('buffer').Buffer;

process.exit = function (code) {
  process.emit("exit");
  process.reallyExit(code);
};

process.kill = function (pid, sig) {
  if (!constants) constants = process.binding("constants");
  sig = sig || 'SIGTERM';
  if (!constants[sig]) throw new Error("Unknown signal: " + sig);
  process._kill(pid, constants[sig]);
};


// Module System
var module = (function () {
  var exports = {};
  // Set the environ variable NODE_MODULE_CONTEXTS=1 to make node load all
  // modules in thier own context.
  var contextLoad = false;
  if (parseInt(process.env["NODE_MODULE_CONTEXTS"]) > 0) contextLoad = true;
  var Script;

  var extensionCache = {};

  function Module (id, parent) {
    this.id = id;
    this.exports = {};
    this.parent = parent;

    if (parent) {
      this.moduleCache = parent.moduleCache;
    } else {
      this.moduleCache = {};
    }

    this.filename = null;
    this.loaded = false;
    this.exited = false;
    this.children = [];
  };


  // Modules

  var debugLevel = parseInt(process.env["NODE_DEBUG"], 16);
  function debug (x) {
    if (debugLevel & 1) {
      process.binding('stdio').writeError(x + "\n");
    }
  }

  var path = requireNative("path");

  var modulePaths = [path.join(process.execPath, "..", "..", "lib", "node")];

  if (process.env["HOME"]) {
    modulePaths.unshift(path.join(process.env["HOME"], ".node_libraries"));
  }

  if (process.env["NODE_PATH"]) {
    modulePaths = process.env["NODE_PATH"].split(":").concat(modulePaths);
  }

  var moduleNativeExtensions = ['js', 'node'];

  // Which files to traverse while finding id? Returns generator function.
  function traverser (id, dirs) {
    var head = [], inDir = [], _dirs = dirs.slice();
    return function next () {
      var result = head.shift();
      if (result) { return result; }

      var gen = inDir.shift();
      if (gen) { head = gen(); return next(); }

      var dir = _dirs.shift();
      if (dir !== undefined) {
        function direct (ext) { return path.join(dir, id + '.' + ext); }
        function index (ext) { return path.join(dir, id, 'index.' + ext); }
        var userExts = Object.keys(extensionCache);
        inDir = [
          function () { return moduleNativeExtensions.map(direct); },
          function () { return userExts.map(direct); },
          function () { return moduleNativeExtensions.map(index); },
          function () { return userExts.map(index); }
        ];
        head = [path.join(dir, id)];
        return next();
      }
    };
  }

  /* Sync unless callback given */
  function findModulePath (id, dirs, callback) {
    process.assert(Array.isArray(dirs));

    if (/^https?:\/\//.exec(id)) {
      if (callback) {
        callback(id);
      } else {
        throw new Error("Sync http require not allowed.");
      }
      return;
    }

    var nextLoc = traverser(id, id.charAt(0) === '/' ? [''] : dirs);

    var fs = requireNative('fs');

    function searchLocations () {
      var location, stats;
      while (location = nextLoc()) {
        try { stats = fs.statSync(location); } catch(e) { continue; }
        if (stats && !stats.isDirectory()) return location;
      }
      return false;
    }

    function searchLocationsAsync (cb) {
      var location = nextLoc();

      if (!location) { cb(false); return; }

      fs.stat(location, function (err, stats) {
        if (stats && !stats.isDirectory()) { cb(location); }
        else { searchLocationsAsync(cb); }
      });
    }

    return callback ? searchLocationsAsync(callback) : searchLocations();
  }


  // sync - no i/o performed
  function resolveModulePath(request, parent) {
    var start = request.substring(0, 2);
    if (start !== "./" && start !== "..") { return [request, modulePaths]; }

    // Relative request
    var exts = moduleNativeExtensions.concat(Object.keys(extensionCache)),
      indexRE = new RegExp('^index\\.(' + exts.join('|') + ')$'),
      // XXX dangerous code: ^^^ what if exts contained some RE control chars?
      isIndex = path.basename(parent.filename).match(indexRE),
      parentIdPath = isIndex ? parent.id : path.dirname(parent.id),
      id = path.join(parentIdPath, request);
    // make sure require('./path') and require('path') get distinct ids, even
    // when called from the toplevel js file
    if (parentIdPath === '.' && id.indexOf('/') === -1) {
      id = './' + id;
    }
    debug("RELATIVE: requested:" + request + " set ID to: "+id+" from "+parent.id);
    return [id, [path.dirname(parent.filename)]];
  }


  function loadModule (request, parent, callback) {
    var resolvedModule = resolveModulePath(request, parent),
        id = resolvedModule[0],
        paths = resolvedModule[1];

    debug("loadModule REQUEST  " + (request) + " parent: " + parent.id);

    // native modules always take precedence.
    if (nativeSource[id]) {
      //debug('load native module ' + id);
      var nativeMod = requireNative(id);
      return callback ? callback(null, nativeMod) : nativeMod;
    }

    // look up the filename first, since that's the cache key.
    debug("looking for " + JSON.stringify(id) + " in " + JSON.stringify(paths));
    if (!callback) {
      // sync
      var filename = findModulePath(request, paths);
      if (!filename) {
        throw new Error("Cannot find module '" + request + "'");
      }

      var cachedModule = parent.moduleCache[filename];
      if (cachedModule) return cachedModule.exports;

      var module = new Module(id, parent);
      module.moduleCache[filename] = module;
      module.loadSync(filename);
      return module.exports;
    }
    // async
    findModulePath(request, paths, function (filename) {
      if (!filename) {
        var err = new Error("Cannot find module '" + request + "'");
        return callback(err);
      }

      var cachedModule = parent.moduleCache[filename];
      if (cachedModule) return callback(null, cachedModule.exports);

      var module = new Module(id, parent);
      module.moduleCache[filename] = module;
      module.load(filename, callback);
    });
  };


  // This function allows the user to register file extensions to custom
  // Javascript 'compilers'.  It accepts 2 arguments, where ext is a file
  // extension as a string. E.g. '.coffee' for coffee-script files.  compiler
  // is the second argument, which is a function that gets called when the
  // specified file extension is found. The compiler is passed a single
  // argument, which is, the file contents, which need to be compiled.
  //
  // The function needs to return the compiled source, or an non-string
  // variable that will get attached directly to the module exports. Example:
  //
  //    require.registerExtension('.coffee', function(content) {
  //      return doCompileMagic(content);
  //    });
  function registerExtension(ext, compiler) {
    if ('string' !== typeof ext && false === /\.\w+$/.test(ext)) {
      throw new Error('require.registerExtension: First argument not a valid extension string.');
    }

    if ('function' !== typeof compiler) {
      throw new Error('require.registerExtension: Second argument not a valid compiler function.');
    }

    extensionCache[ext.slice(1)] = compiler;
  }


  Module.prototype.loadSync = function (filename) {
    debug("loadSync " + JSON.stringify(filename) + " for module " + JSON.stringify(this.id));

    process.assert(!this.loaded);
    this.filename = filename;

    if (filename.match(/\.node$/)) {
      this._loadObjectSync(filename);
    } else {
      this._loadScriptSync(filename);
    }
  };


  Module.prototype.load = function (filename, callback) {
    debug("load " + JSON.stringify(filename) + " for module " + JSON.stringify(this.id));

    process.assert(!this.loaded);

    this.filename = filename;

    if (filename.match(/\.node$/)) {
      this._loadObject(filename, callback);
    } else {
      this._loadScript(filename, callback);
    }
  };


  Module.prototype._loadObjectSync = function (filename) {
    this.loaded = true;
    process.dlopen(filename, this.exports);
  };


  Module.prototype._loadObject = function (filename, callback) {
    var self = this;
    // XXX Not yet supporting loading from HTTP. would need to download the
    // file, store it to tmp then run dlopen on it.
    self.loaded = true;
    process.dlopen(filename, self.exports); // FIXME synchronus
    if (callback) callback(null, self.exports);
  };


  function cat (id, callback) {
    if (id.match(/^http:\/\//)) {
      loadModule('http', process.mainModule, function (err, http) {
        if (err) {
          if (callback) callback(err);
        } else {
          http.cat(id, callback);
        }
      });
    } else {
      requireNative('fs').readFile(id, 'utf8', callback);
    }
  }


  // Returns exception if any
  Module.prototype._compile = function (content, filename) {
    var self = this;
    // remove shebang
    content = content.replace(/^\#\!.*/, '');

    // Compile content if needed
    var ext = path.extname(filename).slice(1);
    if (extensionCache[ext]) {
      content = extensionCache[ext](content);
    }

    if ("string" !== typeof content) {
      self.exports = content;
      return;
    }

    function requireAsync (url, cb) {
      loadModule(url, self, cb);
    }

    function require (path) {
      return loadModule(path, self);
    }

    require.paths = modulePaths;
    require.async = requireAsync;
    require.main = process.mainModule;
    require.registerExtension = registerExtension;

    var dirname = path.dirname(filename);

    if (contextLoad) {
      if (!Script) Script = process.binding('evals').Script;

      if (self.id !== ".") {
        debug('load submodule');
        // not root module
        var sandbox = {};
        for (var k in global) {
          sandbox[k] = global[k];
        }
        sandbox.require     = require;
        sandbox.exports     = self.exports;
        sandbox.__filename  = filename;
        sandbox.__dirname   = dirname;
        sandbox.module      = self;
        sandbox.global      = sandbox;
        sandbox.root        = root;

        Script.runInNewContext(content, sandbox, filename);

      } else {
        debug('load root module');
        // root module
        global.require    = require;
        global.exports    = self.exports;
        global.__filename = filename;
        global.__dirname  = dirname;
        global.module     = self;
        Script.runInThisContext(content, filename);
      }

    } else {
      // create wrapper function
      var wrapper = "(function (exports, require, module, __filename, __dirname) { "
                  + content
                  + "\n});";

      var compiledWrapper = process.compile(wrapper, filename);
      if (filename === process.argv[1] && global.v8debug) {
        global.v8debug.Debug.setBreakPoint(compiledWrapper, 0, 0);
      }
      compiledWrapper.apply(self.exports, [self.exports, require, self, filename, dirname]);
    }
  };


  Module.prototype._loadScriptSync = function (filename) {
    var content = requireNative('fs').readFileSync(filename, 'utf8');
    this._compile(content, filename);
    this.loaded = true;
  };


  Module.prototype._loadScript = function (filename, callback) {
    var self = this;
    cat(filename, function (err, content) {
      debug('cat done');
      if (err) {
        if (callback) callback(err);
      } else {
        try {
          self._compile(content, filename);
        } catch (err) {
          if (callback) callback(err);
          return;
        }

        self._waitChildrenLoad(function () {
          self.loaded = true;
          if (self.onload) self.onload();
          if (callback) callback(null, self.exports);
        });
      }
    });
  };


  Module.prototype._waitChildrenLoad = function (callback) {
    var nloaded = 0;
    var children = this.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.loaded) {
        nloaded++;
      } else {
        child.onload = function () {
          child.onload = null;
          nloaded++;
          if (children.length == nloaded && callback) callback();
        };
      }
    }
    if (children.length == nloaded && callback) callback();
  };



  // bootstrap main module.
  exports.runMain = function () {
    // Load the main module--the command line argument.
    process.mainModule = new Module(".");
    process.mainModule.loadSync(process.argv[1]);
  }

  return exports;
})();


var cwd = process.cwd();
var path = requireNative('path');

// Make process.argv[0] and process.argv[1] into full paths.
if (process.argv[0].indexOf('/') > 0) {
  process.argv[0] = path.join(cwd, process.argv[0]);
}

if (process.argv[1]) {
  if (process.argv[1].charAt(0) != "/" && !(/^http:\/\//).exec(process.argv[1])) {
    process.argv[1] = path.join(cwd, process.argv[1]);
  }

  // REMOVEME: nextTick should not be necessary. This hack to get
  // test/simple/test-exception-handler2.js working.
  process.nextTick(function() {
    module.runMain();
  });
} else {
  // No arguments, run the repl
  requireNative('repl').start();
}

// All our arguments are loaded. We've evaluated all of the scripts. We
// might even have created TCP servers. Now we enter the main eventloop. If
// there are no watchers on the loop (except for the ones that were
// ev_unref'd) then this function exits. As long as there are active
// watchers, it blocks.
process.loop();

process.emit("exit");

});
