"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-array@2.0.0/node_modules/postgres-array/index.js
var require_postgres_array = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-array@2.0.0/node_modules/postgres-array/index.js"(exports2) {
    "use strict";
    exports2.parse = function(source2, transform) {
      return new ArrayParser(source2, transform).parse();
    };
    var ArrayParser = class _ArrayParser {
      constructor(source2, transform) {
        this.source = source2;
        this.transform = transform || identity2;
        this.position = 0;
        this.entries = [];
        this.recorded = [];
        this.dimension = 0;
      }
      isEof() {
        return this.position >= this.source.length;
      }
      nextCharacter() {
        var character = this.source[this.position++];
        if (character === "\\") {
          return {
            value: this.source[this.position++],
            escaped: true
          };
        }
        return {
          value: character,
          escaped: false
        };
      }
      record(character) {
        this.recorded.push(character);
      }
      newEntry(includeEmpty) {
        var entry;
        if (this.recorded.length > 0 || includeEmpty) {
          entry = this.recorded.join("");
          if (entry === "NULL" && !includeEmpty) {
            entry = null;
          }
          if (entry !== null) entry = this.transform(entry);
          this.entries.push(entry);
          this.recorded = [];
        }
      }
      consumeDimensions() {
        if (this.source[0] === "[") {
          while (!this.isEof()) {
            var char = this.nextCharacter();
            if (char.value === "=") break;
          }
        }
      }
      parse(nested) {
        var character, parser, quote;
        this.consumeDimensions();
        while (!this.isEof()) {
          character = this.nextCharacter();
          if (character.value === "{" && !quote) {
            this.dimension++;
            if (this.dimension > 1) {
              parser = new _ArrayParser(this.source.substr(this.position - 1), this.transform);
              this.entries.push(parser.parse(true));
              this.position += parser.position - 2;
            }
          } else if (character.value === "}" && !quote) {
            this.dimension--;
            if (!this.dimension) {
              this.newEntry();
              if (nested) return this.entries;
            }
          } else if (character.value === '"' && !character.escaped) {
            if (quote) this.newEntry(true);
            quote = !quote;
          } else if (character.value === "," && !quote) {
            this.newEntry();
          } else {
            this.record(character.value);
          }
        }
        if (this.dimension !== 0) {
          throw new Error("array dimension not balanced");
        }
        return this.entries;
      }
    };
    function identity2(value) {
      return value;
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/arrayParser.js
var require_arrayParser = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/arrayParser.js"(exports2, module2) {
    var array = require_postgres_array();
    module2.exports = {
      create: function(source2, transform) {
        return {
          parse: function() {
            return array.parse(source2, transform);
          }
        };
      }
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-date@1.0.7/node_modules/postgres-date/index.js
var require_postgres_date = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-date@1.0.7/node_modules/postgres-date/index.js"(exports2, module2) {
    "use strict";
    var DATE_TIME = /(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,})?.*?( BC)?$/;
    var DATE = /^(\d{1,})-(\d{2})-(\d{2})( BC)?$/;
    var TIME_ZONE = /([Z+-])(\d{2})?:?(\d{2})?:?(\d{2})?/;
    var INFINITY = /^-?infinity$/;
    module2.exports = function parseDate(isoDate) {
      if (INFINITY.test(isoDate)) {
        return Number(isoDate.replace("i", "I"));
      }
      var matches = DATE_TIME.exec(isoDate);
      if (!matches) {
        return getDate(isoDate) || null;
      }
      var isBC = !!matches[8];
      var year = parseInt(matches[1], 10);
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches[2], 10) - 1;
      var day = matches[3];
      var hour = parseInt(matches[4], 10);
      var minute = parseInt(matches[5], 10);
      var second = parseInt(matches[6], 10);
      var ms = matches[7];
      ms = ms ? 1e3 * parseFloat(ms) : 0;
      var date;
      var offset = timeZoneOffset(isoDate);
      if (offset != null) {
        date = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
        if (is0To99(year)) {
          date.setUTCFullYear(year);
        }
        if (offset !== 0) {
          date.setTime(date.getTime() - offset);
        }
      } else {
        date = new Date(year, month, day, hour, minute, second, ms);
        if (is0To99(year)) {
          date.setFullYear(year);
        }
      }
      return date;
    };
    function getDate(isoDate) {
      var matches = DATE.exec(isoDate);
      if (!matches) {
        return;
      }
      var year = parseInt(matches[1], 10);
      var isBC = !!matches[4];
      if (isBC) {
        year = bcYearToNegativeYear(year);
      }
      var month = parseInt(matches[2], 10) - 1;
      var day = matches[3];
      var date = new Date(year, month, day);
      if (is0To99(year)) {
        date.setFullYear(year);
      }
      return date;
    }
    function timeZoneOffset(isoDate) {
      if (isoDate.endsWith("+00")) {
        return 0;
      }
      var zone = TIME_ZONE.exec(isoDate.split(" ")[1]);
      if (!zone) return;
      var type = zone[1];
      if (type === "Z") {
        return 0;
      }
      var sign = type === "-" ? -1 : 1;
      var offset = parseInt(zone[2], 10) * 3600 + parseInt(zone[3] || 0, 10) * 60 + parseInt(zone[4] || 0, 10);
      return offset * sign * 1e3;
    }
    function bcYearToNegativeYear(year) {
      return -(year - 1);
    }
    function is0To99(num) {
      return num >= 0 && num < 100;
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/xtend@4.0.2/node_modules/xtend/mutable.js
var require_mutable = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/xtend@4.0.2/node_modules/xtend/mutable.js"(exports2, module2) {
    module2.exports = extend;
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    function extend(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source2 = arguments[i];
        for (var key in source2) {
          if (hasOwnProperty.call(source2, key)) {
            target[key] = source2[key];
          }
        }
      }
      return target;
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-interval@1.2.0/node_modules/postgres-interval/index.js
var require_postgres_interval = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-interval@1.2.0/node_modules/postgres-interval/index.js"(exports2, module2) {
    "use strict";
    var extend = require_mutable();
    module2.exports = PostgresInterval;
    function PostgresInterval(raw) {
      if (!(this instanceof PostgresInterval)) {
        return new PostgresInterval(raw);
      }
      extend(this, parse2(raw));
    }
    var properties = ["seconds", "minutes", "hours", "days", "months", "years"];
    PostgresInterval.prototype.toPostgres = function() {
      var filtered = properties.filter(this.hasOwnProperty, this);
      if (this.milliseconds && filtered.indexOf("seconds") < 0) {
        filtered.push("seconds");
      }
      if (filtered.length === 0) return "0";
      return filtered.map(function(property) {
        var value = this[property] || 0;
        if (property === "seconds" && this.milliseconds) {
          value = (value + this.milliseconds / 1e3).toFixed(6).replace(/\.?0+$/, "");
        }
        return value + " " + property;
      }, this).join(" ");
    };
    var propertiesISOEquivalent = {
      years: "Y",
      months: "M",
      days: "D",
      hours: "H",
      minutes: "M",
      seconds: "S"
    };
    var dateProperties = ["years", "months", "days"];
    var timeProperties = ["hours", "minutes", "seconds"];
    PostgresInterval.prototype.toISOString = PostgresInterval.prototype.toISO = function() {
      var datePart = dateProperties.map(buildProperty, this).join("");
      var timePart = timeProperties.map(buildProperty, this).join("");
      return "P" + datePart + "T" + timePart;
      function buildProperty(property) {
        var value = this[property] || 0;
        if (property === "seconds" && this.milliseconds) {
          value = (value + this.milliseconds / 1e3).toFixed(6).replace(/0+$/, "");
        }
        return value + propertiesISOEquivalent[property];
      }
    };
    var NUMBER = "([+-]?\\d+)";
    var YEAR = NUMBER + "\\s+years?";
    var MONTH = NUMBER + "\\s+mons?";
    var DAY = NUMBER + "\\s+days?";
    var TIME = "([+-])?([\\d]*):(\\d\\d):(\\d\\d)\\.?(\\d{1,6})?";
    var INTERVAL = new RegExp([YEAR, MONTH, DAY, TIME].map(function(regexString) {
      return "(" + regexString + ")?";
    }).join("\\s*"));
    var positions = {
      years: 2,
      months: 4,
      days: 6,
      hours: 9,
      minutes: 10,
      seconds: 11,
      milliseconds: 12
    };
    var negatives = ["hours", "minutes", "seconds", "milliseconds"];
    function parseMilliseconds(fraction) {
      var microseconds = fraction + "000000".slice(fraction.length);
      return parseInt(microseconds, 10) / 1e3;
    }
    function parse2(interval) {
      if (!interval) return {};
      var matches = INTERVAL.exec(interval);
      var isNegative = matches[8] === "-";
      return Object.keys(positions).reduce(function(parsed, property) {
        var position = positions[property];
        var value = matches[position];
        if (!value) return parsed;
        value = property === "milliseconds" ? parseMilliseconds(value) : parseInt(value, 10);
        if (!value) return parsed;
        if (isNegative && ~negatives.indexOf(property)) {
          value *= -1;
        }
        parsed[property] = value;
        return parsed;
      }, {});
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-bytea@1.0.1/node_modules/postgres-bytea/index.js
var require_postgres_bytea = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/postgres-bytea@1.0.1/node_modules/postgres-bytea/index.js"(exports2, module2) {
    "use strict";
    var bufferFrom = Buffer.from || Buffer;
    module2.exports = function parseBytea(input) {
      if (/^\\x/.test(input)) {
        return bufferFrom(input.substr(2), "hex");
      }
      var output = "";
      var i = 0;
      while (i < input.length) {
        if (input[i] !== "\\") {
          output += input[i];
          ++i;
        } else {
          if (/[0-7]{3}/.test(input.substr(i + 1, 3))) {
            output += String.fromCharCode(parseInt(input.substr(i + 1, 3), 8));
            i += 4;
          } else {
            var backslashes = 1;
            while (i + backslashes < input.length && input[i + backslashes] === "\\") {
              backslashes++;
            }
            for (var k = 0; k < Math.floor(backslashes / 2); ++k) {
              output += "\\";
            }
            i += Math.floor(backslashes / 2) * 2;
          }
        }
      }
      return bufferFrom(output, "binary");
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/textParsers.js
var require_textParsers = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/textParsers.js"(exports2, module2) {
    var array = require_postgres_array();
    var arrayParser = require_arrayParser();
    var parseDate = require_postgres_date();
    var parseInterval = require_postgres_interval();
    var parseByteA = require_postgres_bytea();
    function allowNull(fn) {
      return function nullAllowed(value) {
        if (value === null) return value;
        return fn(value);
      };
    }
    function parseBool(value) {
      if (value === null) return value;
      return value === "TRUE" || value === "t" || value === "true" || value === "y" || value === "yes" || value === "on" || value === "1";
    }
    function parseBoolArray(value) {
      if (!value) return null;
      return array.parse(value, parseBool);
    }
    function parseBaseTenInt(string) {
      return parseInt(string, 10);
    }
    function parseIntegerArray(value) {
      if (!value) return null;
      return array.parse(value, allowNull(parseBaseTenInt));
    }
    function parseBigIntegerArray(value) {
      if (!value) return null;
      return array.parse(value, allowNull(function(entry) {
        return parseBigInteger(entry).trim();
      }));
    }
    var parsePointArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parsePoint(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseFloatArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseFloat(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseStringArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value);
      return p.parse();
    };
    var parseDateArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseDate(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseIntervalArray = function(value) {
      if (!value) {
        return null;
      }
      var p = arrayParser.create(value, function(entry) {
        if (entry !== null) {
          entry = parseInterval(entry);
        }
        return entry;
      });
      return p.parse();
    };
    var parseByteAArray = function(value) {
      if (!value) {
        return null;
      }
      return array.parse(value, allowNull(parseByteA));
    };
    var parseInteger = function(value) {
      return parseInt(value, 10);
    };
    var parseBigInteger = function(value) {
      var valStr = String(value);
      if (/^\d+$/.test(valStr)) {
        return valStr;
      }
      return value;
    };
    var parseJsonArray = function(value) {
      if (!value) {
        return null;
      }
      return array.parse(value, allowNull(JSON.parse));
    };
    var parsePoint = function(value) {
      if (value[0] !== "(") {
        return null;
      }
      value = value.substring(1, value.length - 1).split(",");
      return {
        x: parseFloat(value[0]),
        y: parseFloat(value[1])
      };
    };
    var parseCircle = function(value) {
      if (value[0] !== "<" && value[1] !== "(") {
        return null;
      }
      var point = "(";
      var radius = "";
      var pointParsed = false;
      for (var i = 2; i < value.length - 1; i++) {
        if (!pointParsed) {
          point += value[i];
        }
        if (value[i] === ")") {
          pointParsed = true;
          continue;
        } else if (!pointParsed) {
          continue;
        }
        if (value[i] === ",") {
          continue;
        }
        radius += value[i];
      }
      var result = parsePoint(point);
      result.radius = parseFloat(radius);
      return result;
    };
    var init = function(register) {
      register(20, parseBigInteger);
      register(21, parseInteger);
      register(23, parseInteger);
      register(26, parseInteger);
      register(700, parseFloat);
      register(701, parseFloat);
      register(16, parseBool);
      register(1082, parseDate);
      register(1114, parseDate);
      register(1184, parseDate);
      register(600, parsePoint);
      register(651, parseStringArray);
      register(718, parseCircle);
      register(1e3, parseBoolArray);
      register(1001, parseByteAArray);
      register(1005, parseIntegerArray);
      register(1007, parseIntegerArray);
      register(1028, parseIntegerArray);
      register(1016, parseBigIntegerArray);
      register(1017, parsePointArray);
      register(1021, parseFloatArray);
      register(1022, parseFloatArray);
      register(1231, parseFloatArray);
      register(1014, parseStringArray);
      register(1015, parseStringArray);
      register(1008, parseStringArray);
      register(1009, parseStringArray);
      register(1040, parseStringArray);
      register(1041, parseStringArray);
      register(1115, parseDateArray);
      register(1182, parseDateArray);
      register(1185, parseDateArray);
      register(1186, parseInterval);
      register(1187, parseIntervalArray);
      register(17, parseByteA);
      register(114, JSON.parse.bind(JSON));
      register(3802, JSON.parse.bind(JSON));
      register(199, parseJsonArray);
      register(3807, parseJsonArray);
      register(3907, parseStringArray);
      register(2951, parseStringArray);
      register(791, parseStringArray);
      register(1183, parseStringArray);
      register(1270, parseStringArray);
    };
    module2.exports = {
      init
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-int8@1.0.1/node_modules/pg-int8/index.js
var require_pg_int8 = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-int8@1.0.1/node_modules/pg-int8/index.js"(exports2, module2) {
    "use strict";
    var BASE = 1e6;
    function readInt8(buffer) {
      var high = buffer.readInt32BE(0);
      var low = buffer.readUInt32BE(4);
      var sign = "";
      if (high < 0) {
        high = ~high + (low === 0);
        low = ~low + 1 >>> 0;
        sign = "-";
      }
      var result = "";
      var carry;
      var t;
      var digits;
      var pad;
      var l;
      var i;
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        high = high / BASE >>> 0;
        t = 4294967296 * carry + low;
        low = t / BASE >>> 0;
        digits = "" + (t - BASE * low);
        if (low === 0 && high === 0) {
          return sign + digits + result;
        }
        pad = "";
        l = 6 - digits.length;
        for (i = 0; i < l; i++) {
          pad += "0";
        }
        result = pad + digits + result;
      }
      {
        carry = high % BASE;
        t = 4294967296 * carry + low;
        digits = "" + t % BASE;
        return sign + digits + result;
      }
    }
    module2.exports = readInt8;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/binaryParsers.js
var require_binaryParsers = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/binaryParsers.js"(exports2, module2) {
    var parseInt64 = require_pg_int8();
    var parseBits = function(data, bits, offset, invert, callback) {
      offset = offset || 0;
      invert = invert || false;
      callback = callback || function(lastValue, newValue, bits2) {
        return lastValue * Math.pow(2, bits2) + newValue;
      };
      var offsetBytes = offset >> 3;
      var inv = function(value) {
        if (invert) {
          return ~value & 255;
        }
        return value;
      };
      var mask = 255;
      var firstBits = 8 - offset % 8;
      if (bits < firstBits) {
        mask = 255 << 8 - bits & 255;
        firstBits = bits;
      }
      if (offset) {
        mask = mask >> offset % 8;
      }
      var result = 0;
      if (offset % 8 + bits >= 8) {
        result = callback(0, inv(data[offsetBytes]) & mask, firstBits);
      }
      var bytes = bits + offset >> 3;
      for (var i = offsetBytes + 1; i < bytes; i++) {
        result = callback(result, inv(data[i]), 8);
      }
      var lastBits = (bits + offset) % 8;
      if (lastBits > 0) {
        result = callback(result, inv(data[bytes]) >> 8 - lastBits, lastBits);
      }
      return result;
    };
    var parseFloatFromBits = function(data, precisionBits, exponentBits) {
      var bias = Math.pow(2, exponentBits - 1) - 1;
      var sign = parseBits(data, 1);
      var exponent = parseBits(data, exponentBits, 1);
      if (exponent === 0) {
        return 0;
      }
      var precisionBitsCounter = 1;
      var parsePrecisionBits = function(lastValue, newValue, bits) {
        if (lastValue === 0) {
          lastValue = 1;
        }
        for (var i = 1; i <= bits; i++) {
          precisionBitsCounter /= 2;
          if ((newValue & 1 << bits - i) > 0) {
            lastValue += precisionBitsCounter;
          }
        }
        return lastValue;
      };
      var mantissa = parseBits(data, precisionBits, exponentBits + 1, false, parsePrecisionBits);
      if (exponent == Math.pow(2, exponentBits + 1) - 1) {
        if (mantissa === 0) {
          return sign === 0 ? Infinity : -Infinity;
        }
        return NaN;
      }
      return (sign === 0 ? 1 : -1) * Math.pow(2, exponent - bias) * mantissa;
    };
    var parseInt16 = function(value) {
      if (parseBits(value, 1) == 1) {
        return -1 * (parseBits(value, 15, 1, true) + 1);
      }
      return parseBits(value, 15, 1);
    };
    var parseInt32 = function(value) {
      if (parseBits(value, 1) == 1) {
        return -1 * (parseBits(value, 31, 1, true) + 1);
      }
      return parseBits(value, 31, 1);
    };
    var parseFloat32 = function(value) {
      return parseFloatFromBits(value, 23, 8);
    };
    var parseFloat64 = function(value) {
      return parseFloatFromBits(value, 52, 11);
    };
    var parseNumeric = function(value) {
      var sign = parseBits(value, 16, 32);
      if (sign == 49152) {
        return NaN;
      }
      var weight = Math.pow(1e4, parseBits(value, 16, 16));
      var result = 0;
      var digits = [];
      var ndigits = parseBits(value, 16);
      for (var i = 0; i < ndigits; i++) {
        result += parseBits(value, 16, 64 + 16 * i) * weight;
        weight /= 1e4;
      }
      var scale = Math.pow(10, parseBits(value, 16, 48));
      return (sign === 0 ? 1 : -1) * Math.round(result * scale) / scale;
    };
    var parseDate = function(isUTC, value) {
      var sign = parseBits(value, 1);
      var rawValue = parseBits(value, 63, 1);
      var result = new Date((sign === 0 ? 1 : -1) * rawValue / 1e3 + 9466848e5);
      if (!isUTC) {
        result.setTime(result.getTime() + result.getTimezoneOffset() * 6e4);
      }
      result.usec = rawValue % 1e3;
      result.getMicroSeconds = function() {
        return this.usec;
      };
      result.setMicroSeconds = function(value2) {
        this.usec = value2;
      };
      result.getUTCMicroSeconds = function() {
        return this.usec;
      };
      return result;
    };
    var parseArray = function(value) {
      var dim = parseBits(value, 32);
      var flags = parseBits(value, 32, 32);
      var elementType = parseBits(value, 32, 64);
      var offset = 96;
      var dims = [];
      for (var i = 0; i < dim; i++) {
        dims[i] = parseBits(value, 32, offset);
        offset += 32;
        offset += 32;
      }
      var parseElement = function(elementType2) {
        var length = parseBits(value, 32, offset);
        offset += 32;
        if (length == 4294967295) {
          return null;
        }
        var result;
        if (elementType2 == 23 || elementType2 == 20) {
          result = parseBits(value, length * 8, offset);
          offset += length * 8;
          return result;
        } else if (elementType2 == 25) {
          result = value.toString(this.encoding, offset >> 3, (offset += length << 3) >> 3);
          return result;
        } else {
          console.log("ERROR: ElementType not implemented: " + elementType2);
        }
      };
      var parse2 = function(dimension, elementType2) {
        var array = [];
        var i2;
        if (dimension.length > 1) {
          var count2 = dimension.shift();
          for (i2 = 0; i2 < count2; i2++) {
            array[i2] = parse2(dimension, elementType2);
          }
          dimension.unshift(count2);
        } else {
          for (i2 = 0; i2 < dimension[0]; i2++) {
            array[i2] = parseElement(elementType2);
          }
        }
        return array;
      };
      return parse2(dims, elementType);
    };
    var parseText = function(value) {
      return value.toString("utf8");
    };
    var parseBool = function(value) {
      if (value === null) return null;
      return parseBits(value, 8) > 0;
    };
    var init = function(register) {
      register(20, parseInt64);
      register(21, parseInt16);
      register(23, parseInt32);
      register(26, parseInt32);
      register(1700, parseNumeric);
      register(700, parseFloat32);
      register(701, parseFloat64);
      register(16, parseBool);
      register(1114, parseDate.bind(null, false));
      register(1184, parseDate.bind(null, true));
      register(1e3, parseArray);
      register(1007, parseArray);
      register(1016, parseArray);
      register(1008, parseArray);
      register(1009, parseArray);
      register(25, parseText);
    };
    module2.exports = {
      init
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/builtins.js
var require_builtins = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/lib/builtins.js"(exports2, module2) {
    module2.exports = {
      BOOL: 16,
      BYTEA: 17,
      CHAR: 18,
      INT8: 20,
      INT2: 21,
      INT4: 23,
      REGPROC: 24,
      TEXT: 25,
      OID: 26,
      TID: 27,
      XID: 28,
      CID: 29,
      JSON: 114,
      XML: 142,
      PG_NODE_TREE: 194,
      SMGR: 210,
      PATH: 602,
      POLYGON: 604,
      CIDR: 650,
      FLOAT4: 700,
      FLOAT8: 701,
      ABSTIME: 702,
      RELTIME: 703,
      TINTERVAL: 704,
      CIRCLE: 718,
      MACADDR8: 774,
      MONEY: 790,
      MACADDR: 829,
      INET: 869,
      ACLITEM: 1033,
      BPCHAR: 1042,
      VARCHAR: 1043,
      DATE: 1082,
      TIME: 1083,
      TIMESTAMP: 1114,
      TIMESTAMPTZ: 1184,
      INTERVAL: 1186,
      TIMETZ: 1266,
      BIT: 1560,
      VARBIT: 1562,
      NUMERIC: 1700,
      REFCURSOR: 1790,
      REGPROCEDURE: 2202,
      REGOPER: 2203,
      REGOPERATOR: 2204,
      REGCLASS: 2205,
      REGTYPE: 2206,
      UUID: 2950,
      TXID_SNAPSHOT: 2970,
      PG_LSN: 3220,
      PG_NDISTINCT: 3361,
      PG_DEPENDENCIES: 3402,
      TSVECTOR: 3614,
      TSQUERY: 3615,
      GTSVECTOR: 3642,
      REGCONFIG: 3734,
      REGDICTIONARY: 3769,
      JSONB: 3802,
      REGNAMESPACE: 4089,
      REGROLE: 4096
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/index.js
var require_pg_types = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-types@2.2.0/node_modules/pg-types/index.js"(exports2) {
    var textParsers = require_textParsers();
    var binaryParsers = require_binaryParsers();
    var arrayParser = require_arrayParser();
    var builtinTypes = require_builtins();
    exports2.getTypeParser = getTypeParser;
    exports2.setTypeParser = setTypeParser;
    exports2.arrayParser = arrayParser;
    exports2.builtins = builtinTypes;
    var typeParsers = {
      text: {},
      binary: {}
    };
    function noParse(val) {
      return String(val);
    }
    function getTypeParser(oid, format) {
      format = format || "text";
      if (!typeParsers[format]) {
        return noParse;
      }
      return typeParsers[format][oid] || noParse;
    }
    function setTypeParser(oid, format, parseFn) {
      if (typeof format == "function") {
        parseFn = format;
        format = "text";
      }
      typeParsers[format][oid] = parseFn;
    }
    textParsers.init(function(oid, converter) {
      typeParsers.text[oid] = converter;
    });
    binaryParsers.init(function(oid, converter) {
      typeParsers.binary[oid] = converter;
    });
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/defaults.js
var require_defaults = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/defaults.js"(exports2, module2) {
    "use strict";
    var user;
    try {
      user = process.platform === "win32" ? process.env.USERNAME : process.env.USER;
    } catch {
    }
    module2.exports = {
      // database host. defaults to localhost
      host: "localhost",
      // database user's name
      user,
      // name of database to connect
      database: void 0,
      // database user's password
      password: null,
      // a Postgres connection string to be used instead of setting individual connection items
      // NOTE:  Setting this value will cause it to override any other value (such as database or user) defined
      // in the defaults object.
      connectionString: void 0,
      // database port
      port: 5432,
      // number of rows to return at a time from a prepared statement's
      // portal. 0 will return all rows at once
      rows: 0,
      // binary result mode
      binary: false,
      // Connection pool options - see https://github.com/brianc/node-pg-pool
      // number of connections to use in connection pool
      // 0 will disable connection pooling
      max: 10,
      // max milliseconds a client can go unused before it is removed
      // from the pool and destroyed
      idleTimeoutMillis: 3e4,
      client_encoding: "",
      ssl: false,
      // SSL negotiation style: 'postgres' (traditional SSLRequest) or 'direct'
      sslnegotiation: void 0,
      application_name: void 0,
      fallback_application_name: void 0,
      options: void 0,
      parseInputDatesAsUTC: false,
      // max milliseconds any query using this connection will execute for before timing out in error.
      // false=unlimited
      statement_timeout: false,
      // Abort any statement that waits longer than the specified duration in milliseconds while attempting to acquire a lock.
      // false=unlimited
      lock_timeout: false,
      // Terminate any session with an open transaction that has been idle for longer than the specified duration in milliseconds
      // false=unlimited
      idle_in_transaction_session_timeout: false,
      // max milliseconds to wait for query to complete (client side)
      query_timeout: false,
      connect_timeout: 0,
      keepalives: 1,
      keepalives_idle: 0
    };
    var pgTypes = require_pg_types();
    var parseBigInteger = pgTypes.getTypeParser(20, "text");
    var parseBigIntegerArray = pgTypes.getTypeParser(1016, "text");
    module2.exports.__defineSetter__("parseInt8", function(val) {
      pgTypes.setTypeParser(20, "text", val ? pgTypes.getTypeParser(23, "text") : parseBigInteger);
      pgTypes.setTypeParser(1016, "text", val ? pgTypes.getTypeParser(1007, "text") : parseBigIntegerArray);
    });
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/utils.js
var require_utils = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/utils.js"(exports2, module2) {
    "use strict";
    var defaults3 = require_defaults();
    var { isDate } = require("util/types");
    function escapeElement(elementRepresentation) {
      const escaped = elementRepresentation.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return '"' + escaped + '"';
    }
    function arrayString(val) {
      let result = "{";
      for (let i = 0; i < val.length; i++) {
        if (i > 0) {
          result += ",";
        }
        let item = val[i];
        if (item == null) {
          result += "NULL";
        } else if (Array.isArray(item)) {
          result += arrayString(item);
        } else if (ArrayBuffer.isView(item)) {
          if (!(item instanceof Buffer)) {
            item = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
          }
          result += "\\\\x" + item.toString("hex");
        } else {
          result += escapeElement(prepareValue(item));
        }
      }
      result += "}";
      return result;
    }
    var prepareValue = function(val, seen) {
      if (val == null) {
        return null;
      }
      if (typeof val === "object") {
        if (val instanceof Buffer) {
          return val;
        }
        if (ArrayBuffer.isView(val)) {
          return Buffer.from(val.buffer, val.byteOffset, val.byteLength);
        }
        if (isDate(val)) {
          if (defaults3.parseInputDatesAsUTC) {
            return dateToStringUTC(val);
          } else {
            return dateToString(val);
          }
        }
        if (Array.isArray(val)) {
          return arrayString(val);
        }
        return prepareObject(val, seen);
      }
      return val.toString();
    };
    function prepareObject(val, seen) {
      if (val && typeof val.toPostgres === "function") {
        seen = seen || [];
        if (seen.indexOf(val) !== -1) {
          throw new Error('circular reference detected while preparing "' + val + '" for query');
        }
        seen.push(val);
        return prepareValue(val.toPostgres(prepareValue), seen);
      }
      return JSON.stringify(val);
    }
    function dateToString(date) {
      let offset = -date.getTimezoneOffset();
      let year = date.getFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + "T" + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0") + "." + String(date.getMilliseconds()).padStart(3, "0");
      if (offset < 0) {
        ret += "-";
        offset *= -1;
      } else {
        ret += "+";
      }
      ret += String(Math.floor(offset / 60)).padStart(2, "0") + ":" + String(offset % 60).padStart(2, "0");
      if (isBCYear) ret += " BC";
      return ret;
    }
    function dateToStringUTC(date) {
      let year = date.getUTCFullYear();
      const isBCYear = year < 1;
      if (isBCYear) year = Math.abs(year) + 1;
      let ret = String(year).padStart(4, "0") + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0") + "T" + String(date.getUTCHours()).padStart(2, "0") + ":" + String(date.getUTCMinutes()).padStart(2, "0") + ":" + String(date.getUTCSeconds()).padStart(2, "0") + "." + String(date.getUTCMilliseconds()).padStart(3, "0");
      ret += "+00:00";
      if (isBCYear) ret += " BC";
      return ret;
    }
    function normalizeQueryConfig(config, values, callback) {
      config = typeof config === "string" ? { text: config } : config;
      if (values) {
        if (typeof values === "function") {
          config.callback = values;
        } else {
          config.values = values;
        }
      }
      if (callback) {
        config.callback = callback;
      }
      return config;
    }
    var escapeIdentifier2 = function(str) {
      return '"' + str.replace(/"/g, '""') + '"';
    };
    var escapeLiteral2 = function(str) {
      let hasBackslash = false;
      let escaped = "'";
      if (str == null) {
        return "''";
      }
      if (typeof str !== "string") {
        return "''";
      }
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'") {
          escaped += c + c;
        } else if (c === "\\") {
          escaped += c + c;
          hasBackslash = true;
        } else {
          escaped += c;
        }
      }
      escaped += "'";
      if (hasBackslash === true) {
        escaped = " E" + escaped;
      }
      return escaped;
    };
    module2.exports = {
      prepareValue: function prepareValueWrapper(value) {
        return prepareValue(value);
      },
      normalizeQueryConfig,
      escapeIdentifier: escapeIdentifier2,
      escapeLiteral: escapeLiteral2
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/utils.js
var require_utils2 = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/utils.js"(exports2, module2) {
    var nodeCrypto = require("crypto");
    module2.exports = {
      postgresMd5PasswordHash,
      randomBytes,
      deriveKey,
      sha256: sha2563,
      hashByName,
      hmacSha256,
      md5
    };
    var webCrypto = nodeCrypto.webcrypto || globalThis.crypto;
    var subtleCrypto = webCrypto.subtle;
    var textEncoder = new TextEncoder();
    function randomBytes(length) {
      return webCrypto.getRandomValues(Buffer.alloc(length));
    }
    async function md5(string) {
      try {
        return nodeCrypto.createHash("md5").update(string, "utf-8").digest("hex");
      } catch (e) {
        const data = typeof string === "string" ? textEncoder.encode(string) : string;
        const hash10 = await subtleCrypto.digest("MD5", data);
        return Array.from(new Uint8Array(hash10)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    }
    async function postgresMd5PasswordHash(user, password, salt) {
      const inner = await md5(password + user);
      const outer = await md5(Buffer.concat([Buffer.from(inner), salt]));
      return "md5" + outer;
    }
    async function sha2563(text2) {
      return await subtleCrypto.digest("SHA-256", text2);
    }
    async function hashByName(hashName, text2) {
      return await subtleCrypto.digest(hashName, text2);
    }
    async function hmacSha256(keyBuffer, msg) {
      const key = await subtleCrypto.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return await subtleCrypto.sign("HMAC", key, textEncoder.encode(msg));
    }
    async function deriveKey(password, salt, iterations) {
      const key = await subtleCrypto.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
      const params = { name: "PBKDF2", hash: "SHA-256", salt, iterations };
      return await subtleCrypto.deriveBits(params, key, 32 * 8, ["deriveBits"]);
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/cert-signatures.js
var require_cert_signatures = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/cert-signatures.js"(exports2, module2) {
    function x509Error(msg, cert) {
      return new Error("SASL channel binding: " + msg + " when parsing public certificate " + cert.toString("base64"));
    }
    function readASN1Length(data, index) {
      let length = data[index++];
      if (length < 128) return { length, index };
      const lengthBytes = length & 127;
      if (lengthBytes > 4) throw x509Error("bad length", data);
      length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = length << 8 | data[index++];
      }
      return { length, index };
    }
    function readASN1OID(data, index) {
      if (data[index++] !== 6) throw x509Error("non-OID data", data);
      const { length: OIDLength, index: indexAfterOIDLength } = readASN1Length(data, index);
      index = indexAfterOIDLength;
      const lastIndex = index + OIDLength;
      const byte1 = data[index++];
      let oid = (byte1 / 40 >> 0) + "." + byte1 % 40;
      while (index < lastIndex) {
        let value = 0;
        while (index < lastIndex) {
          const nextByte = data[index++];
          value = value << 7 | nextByte & 127;
          if (nextByte < 128) break;
        }
        oid += "." + value;
      }
      return { oid, index };
    }
    function expectASN1Seq(data, index) {
      if (data[index++] !== 48) throw x509Error("non-sequence data", data);
      return readASN1Length(data, index);
    }
    function signatureAlgorithmHashFromCertificate(data, index) {
      if (index === void 0) index = 0;
      index = expectASN1Seq(data, index).index;
      const { length: certInfoLength, index: indexAfterCertInfoLength } = expectASN1Seq(data, index);
      index = indexAfterCertInfoLength + certInfoLength;
      index = expectASN1Seq(data, index).index;
      const { oid, index: indexAfterOID } = readASN1OID(data, index);
      switch (oid) {
        // RSA
        case "1.2.840.113549.1.1.4":
          return "MD5";
        case "1.2.840.113549.1.1.5":
          return "SHA-1";
        case "1.2.840.113549.1.1.11":
          return "SHA-256";
        case "1.2.840.113549.1.1.12":
          return "SHA-384";
        case "1.2.840.113549.1.1.13":
          return "SHA-512";
        case "1.2.840.113549.1.1.14":
          return "SHA-224";
        case "1.2.840.113549.1.1.15":
          return "SHA512-224";
        case "1.2.840.113549.1.1.16":
          return "SHA512-256";
        // ECDSA
        case "1.2.840.10045.4.1":
          return "SHA-1";
        case "1.2.840.10045.4.3.1":
          return "SHA-224";
        case "1.2.840.10045.4.3.2":
          return "SHA-256";
        case "1.2.840.10045.4.3.3":
          return "SHA-384";
        case "1.2.840.10045.4.3.4":
          return "SHA-512";
        // RSASSA-PSS: hash is indicated separately
        case "1.2.840.113549.1.1.10": {
          index = indexAfterOID;
          index = expectASN1Seq(data, index).index;
          if (data[index++] !== 160) throw x509Error("non-tag data", data);
          index = readASN1Length(data, index).index;
          index = expectASN1Seq(data, index).index;
          const { oid: hashOID } = readASN1OID(data, index);
          switch (hashOID) {
            // standalone hash OIDs
            case "1.2.840.113549.2.5":
              return "MD5";
            case "1.3.14.3.2.26":
              return "SHA-1";
            case "2.16.840.1.101.3.4.2.1":
              return "SHA-256";
            case "2.16.840.1.101.3.4.2.2":
              return "SHA-384";
            case "2.16.840.1.101.3.4.2.3":
              return "SHA-512";
          }
          throw x509Error("unknown hash OID " + hashOID, data);
        }
        // Ed25519 -- see https: return//github.com/openssl/openssl/issues/15477
        case "1.3.101.110":
        case "1.3.101.112":
          return "SHA-512";
        // Ed448 -- still not in pg 17.2 (if supported, digest would be SHAKE256 x 64 bytes)
        case "1.3.101.111":
        case "1.3.101.113":
          throw x509Error("Ed448 certificate channel binding is not currently supported by Postgres");
      }
      throw x509Error("unknown OID " + oid, data);
    }
    module2.exports = { signatureAlgorithmHashFromCertificate };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/sasl.js
var require_sasl = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/crypto/sasl.js"(exports2, module2) {
    "use strict";
    var crypto = require_utils2();
    var { signatureAlgorithmHashFromCertificate } = require_cert_signatures();
    function saslprep(password) {
      const nonAsciiSpace = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g;
      const mappedToNothing = /[\u00AD\u034F\u1806\u180B\u180C\u180D\u200C\u200D\u2060\uFE00-\uFE0F\uFEFF]/g;
      return password.replace(nonAsciiSpace, " ").replace(mappedToNothing, "").normalize("NFKC");
    }
    var DEFAULT_MAX_SCRAM_ITERATIONS = 1e5;
    function startSession(mechanisms, stream, scramMaxIterations = DEFAULT_MAX_SCRAM_ITERATIONS) {
      const candidates = ["SCRAM-SHA-256"];
      if (stream) candidates.unshift("SCRAM-SHA-256-PLUS");
      const mechanism = candidates.find((candidate) => mechanisms.includes(candidate));
      if (!mechanism) {
        throw new Error("SASL: Only mechanism(s) " + candidates.join(" and ") + " are supported");
      }
      if (mechanism === "SCRAM-SHA-256-PLUS" && typeof stream.getPeerCertificate !== "function") {
        throw new Error("SASL: Mechanism SCRAM-SHA-256-PLUS requires a certificate");
      }
      const clientNonce = crypto.randomBytes(18).toString("base64");
      const gs2Header = mechanism === "SCRAM-SHA-256-PLUS" ? "p=tls-server-end-point" : stream ? "y" : "n";
      return {
        mechanism,
        clientNonce,
        response: gs2Header + ",,n=*,r=" + clientNonce,
        message: "SASLInitialResponse",
        scramMaxIterations
      };
    }
    async function continueSession(session, password, serverData, stream) {
      if (session.message !== "SASLInitialResponse") {
        throw new Error("SASL: Last message was not SASLInitialResponse");
      }
      if (typeof password !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string");
      }
      if (password === "") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string");
      }
      if (typeof serverData !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: serverData must be a string");
      }
      const sv = parseServerFirstMessage(serverData);
      if (!sv.nonce.startsWith(session.clientNonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
      } else if (sv.nonce.length === session.clientNonce.length) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short");
      }
      const scramMaxIterations = typeof session.scramMaxIterations === "number" ? session.scramMaxIterations : DEFAULT_MAX_SCRAM_ITERATIONS;
      if (scramMaxIterations !== 0 && sv.iteration > scramMaxIterations) {
        throw new Error(
          "SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration count " + sv.iteration + " exceeds scramMaxIterations of " + scramMaxIterations
        );
      }
      const clientFirstMessageBare = "n=*,r=" + session.clientNonce;
      const serverFirstMessage = "r=" + sv.nonce + ",s=" + sv.salt + ",i=" + sv.iteration;
      let channelBinding = stream ? "eSws" : "biws";
      if (session.mechanism === "SCRAM-SHA-256-PLUS") {
        const peerCert = stream.getPeerCertificate().raw;
        let hashName = signatureAlgorithmHashFromCertificate(peerCert);
        if (hashName === "MD5" || hashName === "SHA-1") hashName = "SHA-256";
        const certHash = await crypto.hashByName(hashName, peerCert);
        const bindingData = Buffer.concat([Buffer.from("p=tls-server-end-point,,"), Buffer.from(certHash)]);
        channelBinding = bindingData.toString("base64");
      }
      const clientFinalMessageWithoutProof = "c=" + channelBinding + ",r=" + sv.nonce;
      const authMessage = clientFirstMessageBare + "," + serverFirstMessage + "," + clientFinalMessageWithoutProof;
      const saltBytes = Buffer.from(sv.salt, "base64");
      const saltedPassword = await crypto.deriveKey(saslprep(password), saltBytes, sv.iteration);
      const clientKey = await crypto.hmacSha256(saltedPassword, "Client Key");
      const storedKey = await crypto.sha256(clientKey);
      const clientSignature = await crypto.hmacSha256(storedKey, authMessage);
      const clientProof = xorBuffers(Buffer.from(clientKey), Buffer.from(clientSignature)).toString("base64");
      const serverKey = await crypto.hmacSha256(saltedPassword, "Server Key");
      const serverSignatureBytes = await crypto.hmacSha256(serverKey, authMessage);
      session.message = "SASLResponse";
      session.serverSignature = Buffer.from(serverSignatureBytes).toString("base64");
      session.response = clientFinalMessageWithoutProof + ",p=" + clientProof;
    }
    function finalizeSession(session, serverData) {
      if (session.message !== "SASLResponse") {
        throw new Error("SASL: Last message was not SASLResponse");
      }
      if (typeof serverData !== "string") {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: serverData must be a string");
      }
      const { serverSignature } = parseServerFinalMessage(serverData);
      if (serverSignature !== session.serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature does not match");
      }
    }
    function isPrintableChars(text2) {
      if (typeof text2 !== "string") {
        throw new TypeError("SASL: text must be a string");
      }
      return text2.split("").map((_, i) => text2.charCodeAt(i)).every((c) => c >= 33 && c <= 43 || c >= 45 && c <= 126);
    }
    function isBase64(text2) {
      return /^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(text2);
    }
    function parseAttributePairs(text2) {
      if (typeof text2 !== "string") {
        throw new TypeError("SASL: attribute pairs text must be a string");
      }
      return new Map(
        text2.split(",").map((attrValue) => {
          if (!/^.=/.test(attrValue)) {
            throw new Error("SASL: Invalid attribute pair entry");
          }
          const name = attrValue[0];
          const value = attrValue.substring(2);
          return [name, value];
        })
      );
    }
    function parseServerFirstMessage(data) {
      const attrPairs = parseAttributePairs(data);
      const nonce = attrPairs.get("r");
      if (!nonce) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing");
      } else if (!isPrintableChars(nonce)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce must only contain printable characters");
      }
      const salt = attrPairs.get("s");
      if (!salt) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing");
      } else if (!isBase64(salt)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt must be base64");
      }
      const iterationText = attrPairs.get("i");
      if (!iterationText) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration missing");
      } else if (!/^[1-9][0-9]*$/.test(iterationText)) {
        throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: invalid iteration count");
      }
      const iteration = parseInt(iterationText, 10);
      return {
        nonce,
        salt,
        iteration
      };
    }
    function parseServerFinalMessage(serverData) {
      const attrPairs = parseAttributePairs(serverData);
      const error = attrPairs.get("e");
      const serverSignature = attrPairs.get("v");
      if (error) {
        throw new Error(`SASL: SCRAM-SERVER-FINAL-MESSAGE: server returned error: "${error}"`);
      }
      if (!serverSignature) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing");
      } else if (!isBase64(serverSignature)) {
        throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature must be base64");
      }
      return {
        serverSignature
      };
    }
    function xorBuffers(a, b) {
      if (!Buffer.isBuffer(a)) {
        throw new TypeError("first argument must be a Buffer");
      }
      if (!Buffer.isBuffer(b)) {
        throw new TypeError("second argument must be a Buffer");
      }
      if (a.length !== b.length) {
        throw new Error("Buffer lengths must match");
      }
      if (a.length === 0) {
        throw new Error("Buffers cannot be empty");
      }
      return Buffer.from(a.map((_, i) => a[i] ^ b[i]));
    }
    module2.exports = {
      startSession,
      continueSession,
      finalizeSession,
      DEFAULT_MAX_SCRAM_ITERATIONS
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/type-overrides.js
var require_type_overrides = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/type-overrides.js"(exports2, module2) {
    "use strict";
    var types2 = require_pg_types();
    function TypeOverrides2(userTypes) {
      this._types = userTypes || types2;
      this.text = {};
      this.binary = {};
    }
    TypeOverrides2.prototype.getOverrides = function(format) {
      switch (format) {
        case "text":
          return this.text;
        case "binary":
          return this.binary;
        default:
          return {};
      }
    };
    TypeOverrides2.prototype.setTypeParser = function(oid, format, parseFn) {
      if (typeof format === "function") {
        parseFn = format;
        format = "text";
      }
      this.getOverrides(format)[oid] = parseFn;
    };
    TypeOverrides2.prototype.getTypeParser = function(oid, format) {
      format = format || "text";
      return this.getOverrides(format)[oid] || this._types.getTypeParser(oid, format);
    };
    module2.exports = TypeOverrides2;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-connection-string@2.14.0/node_modules/pg-connection-string/index.js
var require_pg_connection_string = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-connection-string@2.14.0/node_modules/pg-connection-string/index.js"(exports2, module2) {
    "use strict";
    function parse2(str, options = {}) {
      if (str.charAt(0) === "/") {
        const config2 = str.split(" ");
        return { host: config2[0], database: config2[1] };
      }
      const config = /* @__PURE__ */ Object.create(null);
      let result;
      let dummyHost = false;
      if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str)) {
        str = encodeURI(str).replace(/%25(\d\d)/g, "%$1");
      }
      try {
        try {
          result = new URL(str, "postgres://base");
        } catch (e) {
          result = new URL(str.replace("@/", "@___DUMMY___/"), "postgres://base");
          dummyHost = true;
        }
      } catch (err) {
        err.input && (err.input = "*****REDACTED*****");
        throw err;
      }
      for (const entry of result.searchParams.entries()) {
        config[entry[0]] = entry[1];
      }
      config.user = config.user || decodeURIComponent(result.username);
      config.password = config.password || decodeURIComponent(result.password);
      if (result.protocol == "socket:") {
        config.host = decodeURI(result.pathname);
        config.database = result.searchParams.get("db");
        config.client_encoding = result.searchParams.get("encoding");
        return config;
      }
      const hostname2 = dummyHost ? "" : result.hostname;
      if (!config.host) {
        config.host = decodeURIComponent(hostname2);
      } else if (hostname2 && /^%2f/i.test(hostname2)) {
        result.pathname = hostname2 + result.pathname;
      }
      if (!config.port) {
        config.port = result.port;
      }
      const pathname = result.pathname.slice(1) || null;
      config.database = pathname ? decodeURI(pathname) : null;
      if (config.ssl === "true" || config.ssl === "1") {
        config.ssl = true;
      }
      if (config.ssl === "0") {
        config.ssl = false;
      }
      if (config.sslcert || config.sslkey || config.sslrootcert || config.sslmode) {
        config.ssl = {};
      }
      if (config.sslnegotiation === "direct" && config.ssl === void 0) {
        config.ssl = true;
      }
      const fs2 = config.sslcert || config.sslkey || config.sslrootcert ? require("fs") : null;
      if (config.sslcert) {
        config.ssl.cert = fs2.readFileSync(config.sslcert).toString();
      }
      if (config.sslkey) {
        config.ssl.key = fs2.readFileSync(config.sslkey).toString();
      }
      if (config.sslrootcert) {
        config.ssl.ca = fs2.readFileSync(config.sslrootcert).toString();
      }
      if (options.useLibpqCompat && config.uselibpqcompat) {
        throw new Error("Both useLibpqCompat and uselibpqcompat are set. Please use only one of them.");
      }
      if (config.uselibpqcompat === "true" || options.useLibpqCompat) {
        switch (config.sslmode) {
          case "disable": {
            config.ssl = false;
            break;
          }
          case "prefer": {
            config.ssl.rejectUnauthorized = false;
            break;
          }
          case "require": {
            if (config.sslrootcert) {
              config.ssl.checkServerIdentity = function() {
              };
            } else {
              config.ssl.rejectUnauthorized = false;
            }
            break;
          }
          case "verify-ca": {
            if (!config.ssl.ca) {
              throw new Error(
                "SECURITY WARNING: Using sslmode=verify-ca requires specifying a CA with sslrootcert. If a public CA is used, verify-ca allows connections to a server that somebody else may have registered with the CA, making you vulnerable to Man-in-the-Middle attacks. Either specify a custom CA certificate with sslrootcert parameter or use sslmode=verify-full for proper security."
              );
            }
            config.ssl.checkServerIdentity = function() {
            };
            break;
          }
          case "verify-full": {
            break;
          }
        }
      } else {
        switch (config.sslmode) {
          case "disable": {
            config.ssl = false;
            break;
          }
          case "prefer":
          case "require":
          case "verify-ca":
          case "verify-full": {
            if (config.sslmode !== "verify-full") {
              deprecatedSslModeWarning(config.sslmode);
            }
            break;
          }
          case "no-verify": {
            config.ssl.rejectUnauthorized = false;
            break;
          }
        }
      }
      return config;
    }
    function toConnectionOptions(sslConfig) {
      const connectionOptions = Object.entries(sslConfig).reduce((c, [key, value]) => {
        if (value !== void 0 && value !== null) {
          c[key] = value;
        }
        return c;
      }, /* @__PURE__ */ Object.create(null));
      return connectionOptions;
    }
    function toClientConfig(config) {
      const poolConfig = Object.entries(config).reduce((c, [key, value]) => {
        if (key === "ssl") {
          const sslConfig = value;
          if (typeof sslConfig === "boolean") {
            c[key] = sslConfig;
          }
          if (typeof sslConfig === "object") {
            c[key] = toConnectionOptions(sslConfig);
          }
        } else if (value !== void 0 && value !== null) {
          if (key === "port") {
            if (value !== "") {
              const v = parseInt(value, 10);
              if (isNaN(v)) {
                throw new Error(`Invalid ${key}: ${value}`);
              }
              c[key] = v;
            }
          } else {
            c[key] = value;
          }
        }
        return c;
      }, /* @__PURE__ */ Object.create(null));
      return poolConfig;
    }
    function parseIntoClientConfig(str) {
      return toClientConfig(parse2(str));
    }
    function deprecatedSslModeWarning(sslmode) {
      if (!deprecatedSslModeWarning.warned && typeof process !== "undefined" && process.emitWarning) {
        deprecatedSslModeWarning.warned = true;
        process.emitWarning(`SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.

To prepare for this change:
- If you want the current behavior, explicitly use 'sslmode=verify-full'
- If you want libpq compatibility now, use 'uselibpqcompat=true&sslmode=${sslmode}'

See https://www.postgresql.org/docs/current/libpq-ssl.html for libpq SSL mode definitions.`);
      }
    }
    module2.exports = parse2;
    parse2.parse = parse2;
    parse2.toClientConfig = toClientConfig;
    parse2.parseIntoClientConfig = parseIntoClientConfig;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection-parameters.js
var require_connection_parameters = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection-parameters.js"(exports2, module2) {
    "use strict";
    var dns = require("dns");
    var defaults3 = require_defaults();
    var parse2 = require_pg_connection_string().parse;
    var val = function(key, config, envVar) {
      if (config[key]) {
        return config[key];
      }
      if (envVar === void 0) {
        envVar = process.env["PG" + key.toUpperCase()];
      } else if (envVar === false) {
      } else {
        envVar = process.env[envVar];
      }
      return envVar || defaults3[key];
    };
    var readSSLConfigFromEnvironment = function() {
      switch (process.env.PGSSLMODE) {
        case "disable":
          return false;
        case "prefer":
        case "require":
        case "verify-ca":
        case "verify-full":
          return true;
        case "no-verify":
          return { rejectUnauthorized: false };
      }
      return defaults3.ssl;
    };
    var quoteParamValue = function(value) {
      return "'" + ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    };
    var add = function(params, config, paramName) {
      const value = config[paramName];
      if (value !== void 0 && value !== null) {
        params.push(paramName + "=" + quoteParamValue(value));
      }
    };
    var ConnectionParameters = class {
      constructor(config) {
        config = typeof config === "string" ? parse2(config) : config || {};
        if (config.connectionString) {
          config = Object.assign({}, config, parse2(config.connectionString));
        }
        this.user = val("user", config);
        this.database = val("database", config);
        if (this.database === void 0) {
          this.database = this.user;
        }
        this.port = parseInt(val("port", config), 10);
        this.host = val("host", config);
        Object.defineProperty(this, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: val("password", config)
        });
        this.binary = val("binary", config);
        this.options = val("options", config);
        this.ssl = typeof config.ssl === "undefined" ? readSSLConfigFromEnvironment() : config.ssl;
        if (typeof this.ssl === "string") {
          if (this.ssl === "true") {
            this.ssl = true;
          }
        }
        if (this.ssl === "no-verify") {
          this.ssl = { rejectUnauthorized: false };
        }
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this.sslnegotiation = val("sslnegotiation", config, "PGSSLNEGOTIATION");
        if (this.sslnegotiation !== void 0 && this.sslnegotiation !== "postgres" && this.sslnegotiation !== "direct") {
          throw new Error(
            `Invalid sslnegotiation value: "${this.sslnegotiation}". Valid values are "postgres" and "direct".`
          );
        }
        if (this.sslnegotiation === "direct" && !this.ssl) {
          throw new Error("sslnegotiation=direct requires SSL to be enabled");
        }
        this.client_encoding = val("client_encoding", config);
        this.replication = val("replication", config);
        this.isDomainSocket = !(this.host || "").indexOf("/");
        this.application_name = val("application_name", config, "PGAPPNAME");
        this.fallback_application_name = val("fallback_application_name", config, false);
        this.statement_timeout = val("statement_timeout", config, false);
        this.lock_timeout = val("lock_timeout", config, false);
        this.idle_in_transaction_session_timeout = val("idle_in_transaction_session_timeout", config, false);
        this.query_timeout = val("query_timeout", config, false);
        if (config.connectionTimeoutMillis === void 0) {
          this.connect_timeout = process.env.PGCONNECT_TIMEOUT || 0;
        } else {
          this.connect_timeout = Math.floor(config.connectionTimeoutMillis / 1e3);
        }
        if (config.keepAlive === false) {
          this.keepalives = 0;
        } else if (config.keepAlive === true) {
          this.keepalives = 1;
        }
        if (typeof config.keepAliveInitialDelayMillis === "number") {
          this.keepalives_idle = Math.floor(config.keepAliveInitialDelayMillis / 1e3);
        }
      }
      getLibpqConnectionString(cb) {
        const params = [];
        add(params, this, "user");
        add(params, this, "password");
        add(params, this, "port");
        add(params, this, "application_name");
        add(params, this, "fallback_application_name");
        add(params, this, "connect_timeout");
        add(params, this, "options");
        const ssl = typeof this.ssl === "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
        add(params, ssl, "sslmode");
        add(params, ssl, "sslca");
        add(params, ssl, "sslkey");
        add(params, ssl, "sslcert");
        add(params, ssl, "sslrootcert");
        add(params, this, "sslnegotiation");
        if (this.database) {
          params.push("dbname=" + quoteParamValue(this.database));
        }
        if (this.replication) {
          params.push("replication=" + quoteParamValue(this.replication));
        }
        if (this.host) {
          params.push("host=" + quoteParamValue(this.host));
        }
        if (this.isDomainSocket) {
          return cb(null, params.join(" "));
        }
        if (this.client_encoding) {
          params.push("client_encoding=" + quoteParamValue(this.client_encoding));
        }
        dns.lookup(this.host, function(err, address) {
          if (err) return cb(err, null);
          params.push("hostaddr=" + quoteParamValue(address));
          return cb(null, params.join(" "));
        });
      }
    };
    module2.exports = ConnectionParameters;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/result.js
var require_result = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/result.js"(exports2, module2) {
    "use strict";
    var types2 = require_pg_types();
    var matchRegexp = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;
    var Result2 = class {
      constructor(rowMode, types3) {
        this.command = null;
        this.rowCount = null;
        this.oid = null;
        this.rows = [];
        this.fields = [];
        this._parsers = void 0;
        this._types = types3;
        this.RowCtor = null;
        this.rowAsArray = rowMode === "array";
        if (this.rowAsArray) {
          this.parseRow = this._parseRowAsArray;
        }
        this._prebuiltEmptyResultObject = null;
      }
      // adds a command complete message
      addCommandComplete(msg) {
        let match;
        if (msg.text) {
          match = matchRegexp.exec(msg.text);
        } else {
          match = matchRegexp.exec(msg.command);
        }
        if (match) {
          this.command = match[1];
          if (match[3]) {
            this.oid = parseInt(match[2], 10);
            this.rowCount = parseInt(match[3], 10);
          } else if (match[2]) {
            this.rowCount = parseInt(match[2], 10);
          }
        }
      }
      _parseRowAsArray(rowData) {
        const row2 = new Array(rowData.length);
        for (let i = 0, len = rowData.length; i < len; i++) {
          const rawValue = rowData[i];
          if (rawValue !== null) {
            row2[i] = this._parsers[i](rawValue);
          } else {
            row2[i] = null;
          }
        }
        return row2;
      }
      parseRow(rowData) {
        const row2 = { ...this._prebuiltEmptyResultObject };
        for (let i = 0, len = rowData.length; i < len; i++) {
          const rawValue = rowData[i];
          const field = this.fields[i].name;
          if (rawValue !== null) {
            const v = this.fields[i].format === "binary" ? Buffer.from(rawValue) : rawValue;
            row2[field] = this._parsers[i](v);
          } else {
            row2[field] = null;
          }
        }
        return row2;
      }
      addRow(row2) {
        this.rows.push(row2);
      }
      addFields(fieldDescriptions) {
        this.fields = fieldDescriptions;
        if (this.fields.length) {
          this._parsers = new Array(fieldDescriptions.length);
        }
        const row2 = /* @__PURE__ */ Object.create(null);
        for (let i = 0; i < fieldDescriptions.length; i++) {
          const desc = fieldDescriptions[i];
          row2[desc.name] = null;
          if (this._types) {
            this._parsers[i] = this._types.getTypeParser(desc.dataTypeID, desc.format || "text");
          } else {
            this._parsers[i] = types2.getTypeParser(desc.dataTypeID, desc.format || "text");
          }
        }
        this._prebuiltEmptyResultObject = { ...row2 };
      }
    };
    module2.exports = Result2;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/query.js
var require_query = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/query.js"(exports2, module2) {
    "use strict";
    var { EventEmitter } = require("events");
    var Result2 = require_result();
    var utils = require_utils();
    var Query2 = class extends EventEmitter {
      constructor(config, values, callback) {
        super();
        config = utils.normalizeQueryConfig(config, values, callback);
        this.text = config.text;
        this.values = config.values;
        this.rows = config.rows;
        this.types = config.types;
        this.name = config.name;
        this.queryMode = config.queryMode;
        this.binary = config.binary;
        this.portal = config.portal || "";
        this.callback = config.callback;
        this._rowMode = config.rowMode;
        if (process.domain && config.callback) {
          this.callback = process.domain.bind(config.callback);
        }
        this._result = new Result2(this._rowMode, this.types);
        this._results = this._result;
        this._canceledDueToError = false;
      }
      requiresPreparation() {
        if (this.queryMode === "extended") {
          return true;
        }
        if (this.name) {
          return true;
        }
        if (this.rows) {
          return true;
        }
        if (!this.text) {
          return false;
        }
        if (!this.values) {
          return false;
        }
        return this.values.length > 0;
      }
      _checkForMultirow() {
        if (this._result.command) {
          if (!Array.isArray(this._results)) {
            this._results = [this._result];
          }
          this._result = new Result2(this._rowMode, this._result._types);
          this._results.push(this._result);
        }
      }
      // associates row metadata from the supplied
      // message with this query object
      // metadata used when parsing row results
      handleRowDescription(msg) {
        this._checkForMultirow();
        this._result.addFields(msg.fields);
        this._accumulateRows = this.callback || !this.listeners("row").length;
      }
      handleDataRow(msg) {
        let row2;
        if (this._canceledDueToError) {
          return;
        }
        try {
          row2 = this._result.parseRow(msg.fields);
        } catch (err) {
          this._canceledDueToError = err;
          return;
        }
        this.emit("row", row2, this._result);
        if (this._accumulateRows) {
          this._result.addRow(row2);
        }
      }
      handleCommandComplete(msg, connection) {
        this._checkForMultirow();
        this._result.addCommandComplete(msg);
        if (this.rows) {
          connection.sync();
        }
      }
      // if a named prepared statement is created with empty query text
      // the backend will send an emptyQuery message but *not* a command complete message
      // since we pipeline sync immediately after execute we don't need to do anything here
      // unless we have rows specified, in which case we did not pipeline the initial sync call
      handleEmptyQuery(connection) {
        if (this.rows) {
          connection.sync();
        }
      }
      handleError(err, connection) {
        if (this._canceledDueToError) {
          err = this._canceledDueToError;
          this._canceledDueToError = false;
        }
        if (this.callback) {
          return this.callback(err);
        }
        this.emit("error", err);
      }
      handleReadyForQuery(con) {
        if (this._canceledDueToError) {
          return this.handleError(this._canceledDueToError, con);
        }
        if (this.callback) {
          try {
            this.callback(null, this._results);
          } catch (err) {
            process.nextTick(() => {
              throw err;
            });
          }
        }
        this.emit("end", this._results);
      }
      submit(connection) {
        if (typeof this.text !== "string" && typeof this.name !== "string") {
          return new Error("A query must have either text or a name. Supplying neither is unsupported.");
        }
        const previous = connection.parsedStatements[this.name];
        if (this.text && previous && this.text !== previous) {
          return new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
        }
        if (this.values && !Array.isArray(this.values)) {
          return new Error("Query values must be an array");
        }
        if (this.requiresPreparation()) {
          connection.stream.cork && connection.stream.cork();
          try {
            this.prepare(connection);
          } finally {
            connection.stream.uncork && connection.stream.uncork();
          }
        } else {
          connection.query(this.text);
        }
        return null;
      }
      hasBeenParsed(connection) {
        return this.name && connection.parsedStatements[this.name];
      }
      handlePortalSuspended(connection) {
        this._getRows(connection, this.rows);
      }
      _getRows(connection, rows) {
        connection.execute({
          portal: this.portal,
          rows
        });
        if (!rows) {
          connection.sync();
        } else {
          connection.flush();
        }
      }
      // http://developer.postgresql.org/pgdocs/postgres/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
      prepare(connection) {
        if (!this.hasBeenParsed(connection)) {
          connection.parse({
            text: this.text,
            name: this.name,
            types: this.types
          });
        }
        try {
          connection.bind({
            portal: this.portal,
            statement: this.name,
            values: this.values,
            binary: this.binary,
            valueMapper: utils.prepareValue
          });
        } catch (err) {
          connection.close({ type: "S", name: this.name });
          connection.sync();
          this.handleError(err, connection);
          return;
        }
        connection.describe({
          type: "P",
          name: this.portal || ""
        });
        this._getRows(connection, this.rows);
      }
      handleCopyInResponse(connection) {
        connection.sendCopyFail("No source stream defined");
      }
      handleCopyData(msg, connection) {
      }
    };
    module2.exports = Query2;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/messages.js
var require_messages = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/messages.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.NoticeMessage = exports2.DataRowMessage = exports2.CommandCompleteMessage = exports2.ReadyForQueryMessage = exports2.NotificationResponseMessage = exports2.BackendKeyDataMessage = exports2.AuthenticationMD5Password = exports2.ParameterStatusMessage = exports2.ParameterDescriptionMessage = exports2.RowDescriptionMessage = exports2.Field = exports2.CopyResponse = exports2.CopyDataMessage = exports2.DatabaseError = exports2.copyDone = exports2.emptyQuery = exports2.replicationStart = exports2.portalSuspended = exports2.noData = exports2.closeComplete = exports2.bindComplete = exports2.parseComplete = void 0;
    exports2.parseComplete = {
      name: "parseComplete",
      length: 5
    };
    exports2.bindComplete = {
      name: "bindComplete",
      length: 5
    };
    exports2.closeComplete = {
      name: "closeComplete",
      length: 5
    };
    exports2.noData = {
      name: "noData",
      length: 5
    };
    exports2.portalSuspended = {
      name: "portalSuspended",
      length: 5
    };
    exports2.replicationStart = {
      name: "replicationStart",
      length: 4
    };
    exports2.emptyQuery = {
      name: "emptyQuery",
      length: 4
    };
    exports2.copyDone = {
      name: "copyDone",
      length: 4
    };
    var DatabaseError2 = class extends Error {
      constructor(message, length, name) {
        super(message);
        this.length = length;
        this.name = name;
      }
    };
    exports2.DatabaseError = DatabaseError2;
    var CopyDataMessage = class {
      constructor(length, chunk) {
        this.length = length;
        this.chunk = chunk;
        this.name = "copyData";
      }
    };
    exports2.CopyDataMessage = CopyDataMessage;
    var CopyResponse = class {
      constructor(length, name, binary, columnCount) {
        this.length = length;
        this.name = name;
        this.binary = binary;
        this.columnTypes = new Array(columnCount);
      }
    };
    exports2.CopyResponse = CopyResponse;
    var Field = class {
      constructor(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, format) {
        this.name = name;
        this.tableID = tableID;
        this.columnID = columnID;
        this.dataTypeID = dataTypeID;
        this.dataTypeSize = dataTypeSize;
        this.dataTypeModifier = dataTypeModifier;
        this.format = format;
      }
    };
    exports2.Field = Field;
    var RowDescriptionMessage = class {
      constructor(length, fieldCount) {
        this.length = length;
        this.fieldCount = fieldCount;
        this.name = "rowDescription";
        this.fields = new Array(this.fieldCount);
      }
    };
    exports2.RowDescriptionMessage = RowDescriptionMessage;
    var ParameterDescriptionMessage = class {
      constructor(length, parameterCount) {
        this.length = length;
        this.parameterCount = parameterCount;
        this.name = "parameterDescription";
        this.dataTypeIDs = new Array(this.parameterCount);
      }
    };
    exports2.ParameterDescriptionMessage = ParameterDescriptionMessage;
    var ParameterStatusMessage = class {
      constructor(length, parameterName, parameterValue) {
        this.length = length;
        this.parameterName = parameterName;
        this.parameterValue = parameterValue;
        this.name = "parameterStatus";
      }
    };
    exports2.ParameterStatusMessage = ParameterStatusMessage;
    var AuthenticationMD5Password = class {
      constructor(length, salt) {
        this.length = length;
        this.salt = salt;
        this.name = "authenticationMD5Password";
      }
    };
    exports2.AuthenticationMD5Password = AuthenticationMD5Password;
    var BackendKeyDataMessage = class {
      constructor(length, processID, secretKey) {
        this.length = length;
        this.processID = processID;
        this.secretKey = secretKey;
        this.name = "backendKeyData";
      }
    };
    exports2.BackendKeyDataMessage = BackendKeyDataMessage;
    var NotificationResponseMessage = class {
      constructor(length, processId, channel, payload2) {
        this.length = length;
        this.processId = processId;
        this.channel = channel;
        this.payload = payload2;
        this.name = "notification";
      }
    };
    exports2.NotificationResponseMessage = NotificationResponseMessage;
    var ReadyForQueryMessage = class {
      constructor(length, status) {
        this.length = length;
        this.status = status;
        this.name = "readyForQuery";
      }
    };
    exports2.ReadyForQueryMessage = ReadyForQueryMessage;
    var CommandCompleteMessage = class {
      constructor(length, text2) {
        this.length = length;
        this.text = text2;
        this.name = "commandComplete";
      }
    };
    exports2.CommandCompleteMessage = CommandCompleteMessage;
    var DataRowMessage = class {
      constructor(length, fields) {
        this.length = length;
        this.fields = fields;
        this.name = "dataRow";
        this.fieldCount = fields.length;
      }
    };
    exports2.DataRowMessage = DataRowMessage;
    var NoticeMessage = class {
      constructor(length, message) {
        this.length = length;
        this.message = message;
        this.name = "notice";
      }
    };
    exports2.NoticeMessage = NoticeMessage;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-writer.js
var require_buffer_writer = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-writer.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Writer = void 0;
    var Writer = class {
      constructor(size = 256) {
        this.size = size;
        this.offset = 5;
        this.headerPosition = 0;
        this.buffer = Buffer.allocUnsafe(size);
      }
      ensure(size) {
        const remaining = this.buffer.length - this.offset;
        if (remaining < size) {
          const oldBuffer = this.buffer;
          const newSize = oldBuffer.length + (oldBuffer.length >> 1) + size;
          this.buffer = Buffer.allocUnsafe(newSize);
          oldBuffer.copy(this.buffer);
        }
      }
      addInt32(num) {
        this.ensure(4);
        this.buffer[this.offset++] = num >>> 24 & 255;
        this.buffer[this.offset++] = num >>> 16 & 255;
        this.buffer[this.offset++] = num >>> 8 & 255;
        this.buffer[this.offset++] = num >>> 0 & 255;
        return this;
      }
      addInt16(num) {
        this.ensure(2);
        this.buffer[this.offset++] = num >>> 8 & 255;
        this.buffer[this.offset++] = num >>> 0 & 255;
        return this;
      }
      addCString(string) {
        if (!string) {
          this.ensure(1);
        } else {
          const len = Buffer.byteLength(string);
          this.ensure(len + 1);
          this.buffer.write(string, this.offset, "utf-8");
          this.offset += len;
        }
        this.buffer[this.offset++] = 0;
        return this;
      }
      addString(string = "") {
        const len = Buffer.byteLength(string);
        this.ensure(len);
        this.buffer.write(string, this.offset);
        this.offset += len;
        return this;
      }
      // Write an Int32 byte-length prefix immediately followed by the string's UTF-8
      // bytes. Postgres' Bind wire format prefixes every parameter with its length,
      // and doing it in one method computes Buffer.byteLength ONCE — the previous
      // `addInt32(Buffer.byteLength(s)).addString(s)` pairing scanned the string
      // three times (byteLength for the prefix, byteLength again inside addString,
      // then the encode), which is costly for large text parameters.
      addInt32PrefixedString(string) {
        const len = Buffer.byteLength(string);
        this.ensure(4 + len);
        const buffer = this.buffer;
        let offset = this.offset;
        buffer[offset++] = len >>> 24 & 255;
        buffer[offset++] = len >>> 16 & 255;
        buffer[offset++] = len >>> 8 & 255;
        buffer[offset++] = len >>> 0 & 255;
        buffer.write(string, offset, "utf-8");
        this.offset = offset + len;
        return this;
      }
      add(otherBuffer) {
        this.ensure(otherBuffer.length);
        otherBuffer.copy(this.buffer, this.offset);
        this.offset += otherBuffer.length;
        return this;
      }
      join(code) {
        if (code) {
          this.buffer[this.headerPosition] = code;
          const length = this.offset - (this.headerPosition + 1);
          this.buffer.writeInt32BE(length, this.headerPosition + 1);
        }
        return this.buffer.slice(code ? 0 : 5, this.offset);
      }
      flush(code) {
        const result = this.join(code);
        this.offset = 5;
        this.headerPosition = 0;
        this.buffer = Buffer.allocUnsafe(this.size);
        return result;
      }
      clear() {
        this.offset = 5;
        this.headerPosition = 0;
      }
    };
    exports2.Writer = Writer;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/serializer.js
var require_serializer = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/serializer.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.serialize = void 0;
    var buffer_writer_1 = require_buffer_writer();
    var writer = new buffer_writer_1.Writer();
    var startup = (opts) => {
      writer.addInt16(3).addInt16(0);
      for (const key of Object.keys(opts)) {
        writer.addCString(key).addCString(opts[key]);
      }
      writer.addCString("client_encoding").addCString("UTF8");
      const bodyBuffer = writer.addCString("").flush();
      const length = bodyBuffer.length + 4;
      return new buffer_writer_1.Writer().addInt32(length).add(bodyBuffer).flush();
    };
    var requestSsl = () => {
      const response = Buffer.allocUnsafe(8);
      response.writeInt32BE(8, 0);
      response.writeInt32BE(80877103, 4);
      return response;
    };
    var password = (password2) => {
      return writer.addCString(password2).flush(
        112
        /* code.startup */
      );
    };
    var sendSASLInitialResponseMessage = function(mechanism, initialResponse) {
      writer.addCString(mechanism).addInt32PrefixedString(initialResponse);
      return writer.flush(
        112
        /* code.startup */
      );
    };
    var sendSCRAMClientFinalMessage = function(additionalData) {
      return writer.addString(additionalData).flush(
        112
        /* code.startup */
      );
    };
    var query = (text2) => {
      return writer.addCString(text2).flush(
        81
        /* code.query */
      );
    };
    var emptyArray = [];
    var parse2 = (query2) => {
      const name = query2.name || "";
      if (name.length > 63) {
        console.error("Warning! Postgres only supports 63 characters for query names.");
        console.error("You supplied %s (%s)", name, name.length);
        console.error("This can cause conflicts and silent errors executing queries");
      }
      const types2 = query2.types || emptyArray;
      const len = types2.length;
      const buffer = writer.addCString(name).addCString(query2.text).addInt16(len);
      for (let i = 0; i < len; i++) {
        buffer.addInt32(types2[i]);
      }
      return writer.flush(
        80
        /* code.parse */
      );
    };
    var paramWriter = new buffer_writer_1.Writer();
    var writeValues = function(values, valueMapper) {
      for (let i = 0; i < values.length; i++) {
        const mappedVal = valueMapper ? valueMapper(values[i], i) : values[i];
        if (mappedVal == null) {
          writer.addInt16(
            0
            /* ParamType.STRING */
          );
          paramWriter.addInt32(-1);
        } else if (mappedVal instanceof Buffer) {
          writer.addInt16(
            1
            /* ParamType.BINARY */
          );
          paramWriter.addInt32(mappedVal.length);
          paramWriter.add(mappedVal);
        } else {
          writer.addInt16(
            0
            /* ParamType.STRING */
          );
          paramWriter.addInt32PrefixedString(mappedVal);
        }
      }
    };
    var bind = (config = {}) => {
      const portal = config.portal || "";
      const statement = config.statement || "";
      const binary = config.binary || false;
      const values = config.values || emptyArray;
      const len = values.length;
      writer.addCString(portal).addCString(statement);
      writer.addInt16(len);
      try {
        writeValues(values, config.valueMapper);
      } catch (err) {
        writer.clear();
        paramWriter.clear();
        throw err;
      }
      writer.addInt16(len);
      writer.add(paramWriter.flush());
      writer.addInt16(1);
      writer.addInt16(
        binary ? 1 : 0
        /* ParamType.STRING */
      );
      return writer.flush(
        66
        /* code.bind */
      );
    };
    var emptyExecute = Buffer.from([69, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
    var execute2 = (config) => {
      if (!config || !config.portal && !config.rows) {
        return emptyExecute;
      }
      const portal = config.portal || "";
      const rows = config.rows || 0;
      const portalLength = Buffer.byteLength(portal);
      const len = 4 + portalLength + 1 + 4;
      const buff = Buffer.allocUnsafe(1 + len);
      buff[0] = 69;
      buff.writeInt32BE(len, 1);
      buff.write(portal, 5, "utf-8");
      buff[portalLength + 5] = 0;
      buff.writeUInt32BE(rows, buff.length - 4);
      return buff;
    };
    var cancel = (processID, secretKey) => {
      const buffer = Buffer.allocUnsafe(16);
      buffer.writeInt32BE(16, 0);
      buffer.writeInt16BE(1234, 4);
      buffer.writeInt16BE(5678, 6);
      buffer.writeInt32BE(processID, 8);
      buffer.writeInt32BE(secretKey, 12);
      return buffer;
    };
    var cstringMessage = (code, string) => {
      const stringLen = Buffer.byteLength(string);
      const len = 4 + stringLen + 1;
      const buffer = Buffer.allocUnsafe(1 + len);
      buffer[0] = code;
      buffer.writeInt32BE(len, 1);
      buffer.write(string, 5, "utf-8");
      buffer[len] = 0;
      return buffer;
    };
    var emptyDescribePortal = writer.addCString("P").flush(
      68
      /* code.describe */
    );
    var emptyDescribeStatement = writer.addCString("S").flush(
      68
      /* code.describe */
    );
    var describe = (msg) => {
      return msg.name ? cstringMessage(68, `${msg.type}${msg.name || ""}`) : msg.type === "P" ? emptyDescribePortal : emptyDescribeStatement;
    };
    var close = (msg) => {
      const text2 = `${msg.type}${msg.name || ""}`;
      return cstringMessage(67, text2);
    };
    var copyData = (chunk) => {
      return writer.add(chunk).flush(
        100
        /* code.copyFromChunk */
      );
    };
    var copyFail = (message) => {
      return cstringMessage(102, message);
    };
    var codeOnlyBuffer = (code) => Buffer.from([code, 0, 0, 0, 4]);
    var flushBuffer = codeOnlyBuffer(
      72
      /* code.flush */
    );
    var syncBuffer = codeOnlyBuffer(
      83
      /* code.sync */
    );
    var endBuffer = codeOnlyBuffer(
      88
      /* code.end */
    );
    var copyDoneBuffer = codeOnlyBuffer(
      99
      /* code.copyDone */
    );
    var serialize = {
      startup,
      password,
      requestSsl,
      sendSASLInitialResponseMessage,
      sendSCRAMClientFinalMessage,
      query,
      parse: parse2,
      bind,
      execute: execute2,
      describe,
      close,
      flush: () => flushBuffer,
      sync: () => syncBuffer,
      end: () => endBuffer,
      copyData,
      copyDone: () => copyDoneBuffer,
      copyFail,
      cancel
    };
    exports2.serialize = serialize;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-reader.js
var require_buffer_reader = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/buffer-reader.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.BufferReader = void 0;
    var BufferReader = class {
      constructor(offset = 0) {
        this.offset = offset;
        this.buffer = Buffer.allocUnsafe(0);
        this.encoding = "utf-8";
      }
      setBuffer(offset, buffer) {
        this.offset = offset;
        this.buffer = buffer;
      }
      int16() {
        const result = this.buffer.readInt16BE(this.offset);
        this.offset += 2;
        return result;
      }
      byte() {
        const result = this.buffer[this.offset];
        this.offset++;
        return result;
      }
      int32() {
        const result = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return result;
      }
      uint32() {
        const result = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return result;
      }
      string(length) {
        const result = this.buffer.toString(this.encoding, this.offset, this.offset + length);
        this.offset += length;
        return result;
      }
      cstring() {
        const start = this.offset;
        let end = start;
        while (this.buffer[end++]) {
        }
        this.offset = end;
        return this.buffer.toString(this.encoding, start, end - 1);
      }
      bytes(length) {
        const result = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return result;
      }
    };
    exports2.BufferReader = BufferReader;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js
var require_parser = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Parser = void 0;
    var messages_1 = require_messages();
    var buffer_reader_1 = require_buffer_reader();
    var CODE_LENGTH = 1;
    var LEN_LENGTH = 4;
    var HEADER_LENGTH = CODE_LENGTH + LEN_LENGTH;
    var LATEINIT_LENGTH = -1;
    var emptyBuffer = Buffer.allocUnsafe(0);
    var Parser = class {
      constructor(opts) {
        this.buffer = emptyBuffer;
        this.bufferLength = 0;
        this.bufferOffset = 0;
        this.reader = new buffer_reader_1.BufferReader();
        if ((opts === null || opts === void 0 ? void 0 : opts.mode) === "binary") {
          throw new Error("Binary mode not supported yet");
        }
        this.mode = (opts === null || opts === void 0 ? void 0 : opts.mode) || "text";
      }
      parse(buffer, callback) {
        this.mergeBuffer(buffer);
        const bufferFullLength = this.bufferOffset + this.bufferLength;
        let offset = this.bufferOffset;
        while (offset + HEADER_LENGTH <= bufferFullLength) {
          const code = this.buffer[offset];
          const length = this.buffer.readUInt32BE(offset + CODE_LENGTH);
          const fullMessageLength = CODE_LENGTH + length;
          if (fullMessageLength + offset <= bufferFullLength) {
            const message = this.handlePacket(offset + HEADER_LENGTH, code, length, this.buffer);
            callback(message);
            offset += fullMessageLength;
          } else {
            break;
          }
        }
        if (offset === bufferFullLength) {
          this.buffer = emptyBuffer;
          this.bufferLength = 0;
          this.bufferOffset = 0;
        } else {
          this.bufferLength = bufferFullLength - offset;
          this.bufferOffset = offset;
        }
      }
      mergeBuffer(buffer) {
        if (this.bufferLength > 0) {
          const newLength = this.bufferLength + buffer.byteLength;
          const newFullLength = newLength + this.bufferOffset;
          if (newFullLength > this.buffer.byteLength) {
            let newBuffer;
            if (newLength <= this.buffer.byteLength && this.bufferOffset >= this.bufferLength) {
              newBuffer = this.buffer;
            } else {
              let newBufferLength = this.buffer.byteLength * 2;
              while (newLength >= newBufferLength) {
                newBufferLength *= 2;
              }
              newBuffer = Buffer.allocUnsafe(newBufferLength);
            }
            this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset + this.bufferLength);
            this.buffer = newBuffer;
            this.bufferOffset = 0;
          }
          buffer.copy(this.buffer, this.bufferOffset + this.bufferLength);
          this.bufferLength = newLength;
        } else {
          this.buffer = buffer;
          this.bufferOffset = 0;
          this.bufferLength = buffer.byteLength;
        }
      }
      handlePacket(offset, code, length, bytes) {
        const { reader } = this;
        reader.setBuffer(offset, bytes);
        let message;
        switch (code) {
          case 50:
            message = messages_1.bindComplete;
            break;
          case 49:
            message = messages_1.parseComplete;
            break;
          case 51:
            message = messages_1.closeComplete;
            break;
          case 110:
            message = messages_1.noData;
            break;
          case 115:
            message = messages_1.portalSuspended;
            break;
          case 99:
            message = messages_1.copyDone;
            break;
          case 87:
            message = messages_1.replicationStart;
            break;
          case 73:
            message = messages_1.emptyQuery;
            break;
          case 68:
            message = parseDataRowMessage(reader);
            break;
          case 67:
            message = parseCommandCompleteMessage(reader);
            break;
          case 90:
            message = parseReadyForQueryMessage(reader);
            break;
          case 65:
            message = parseNotificationMessage(reader);
            break;
          case 82:
            message = parseAuthenticationResponse(reader, length);
            break;
          case 83:
            message = parseParameterStatusMessage(reader);
            break;
          case 75:
            message = parseBackendKeyData(reader);
            break;
          case 69:
            message = parseErrorMessage(reader, "error");
            break;
          case 78:
            message = parseErrorMessage(reader, "notice");
            break;
          case 84:
            message = parseRowDescriptionMessage(reader);
            break;
          case 116:
            message = parseParameterDescriptionMessage(reader);
            break;
          case 71:
            message = parseCopyInMessage(reader);
            break;
          case 72:
            message = parseCopyOutMessage(reader);
            break;
          case 100:
            message = parseCopyData(reader, length);
            break;
          default:
            return new messages_1.DatabaseError("received invalid response: " + code.toString(16), length, "error");
        }
        reader.setBuffer(0, emptyBuffer);
        message.length = length;
        return message;
      }
    };
    exports2.Parser = Parser;
    var parseReadyForQueryMessage = (reader) => {
      const status = reader.string(1);
      return new messages_1.ReadyForQueryMessage(LATEINIT_LENGTH, status);
    };
    var parseCommandCompleteMessage = (reader) => {
      const text2 = reader.cstring();
      return new messages_1.CommandCompleteMessage(LATEINIT_LENGTH, text2);
    };
    var parseCopyData = (reader, length) => {
      const chunk = reader.bytes(length - 4);
      return new messages_1.CopyDataMessage(LATEINIT_LENGTH, chunk);
    };
    var parseCopyInMessage = (reader) => parseCopyMessage(reader, "copyInResponse");
    var parseCopyOutMessage = (reader) => parseCopyMessage(reader, "copyOutResponse");
    var parseCopyMessage = (reader, messageName) => {
      const isBinary = reader.byte() !== 0;
      const columnCount = reader.int16();
      const message = new messages_1.CopyResponse(LATEINIT_LENGTH, messageName, isBinary, columnCount);
      for (let i = 0; i < columnCount; i++) {
        message.columnTypes[i] = reader.int16();
      }
      return message;
    };
    var parseNotificationMessage = (reader) => {
      const processId = reader.int32();
      const channel = reader.cstring();
      const payload2 = reader.cstring();
      return new messages_1.NotificationResponseMessage(LATEINIT_LENGTH, processId, channel, payload2);
    };
    var parseRowDescriptionMessage = (reader) => {
      const fieldCount = reader.int16();
      const message = new messages_1.RowDescriptionMessage(LATEINIT_LENGTH, fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        message.fields[i] = parseField(reader);
      }
      return message;
    };
    var parseField = (reader) => {
      const name = reader.cstring();
      const tableID = reader.uint32();
      const columnID = reader.int16();
      const dataTypeID = reader.uint32();
      const dataTypeSize = reader.int16();
      const dataTypeModifier = reader.int32();
      const mode = reader.int16() === 0 ? "text" : "binary";
      return new messages_1.Field(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, mode);
    };
    var parseParameterDescriptionMessage = (reader) => {
      const parameterCount = reader.int16();
      const message = new messages_1.ParameterDescriptionMessage(LATEINIT_LENGTH, parameterCount);
      for (let i = 0; i < parameterCount; i++) {
        message.dataTypeIDs[i] = reader.int32();
      }
      return message;
    };
    var parseDataRowMessage = (reader) => {
      const fieldCount = reader.int16();
      const fields = new Array(fieldCount);
      for (let i = 0; i < fieldCount; i++) {
        const len = reader.int32();
        fields[i] = len === -1 ? null : reader.string(len);
      }
      return new messages_1.DataRowMessage(LATEINIT_LENGTH, fields);
    };
    var parseParameterStatusMessage = (reader) => {
      const name = reader.cstring();
      const value = reader.cstring();
      return new messages_1.ParameterStatusMessage(LATEINIT_LENGTH, name, value);
    };
    var parseBackendKeyData = (reader) => {
      const processID = reader.int32();
      const secretKey = reader.int32();
      return new messages_1.BackendKeyDataMessage(LATEINIT_LENGTH, processID, secretKey);
    };
    var parseAuthenticationResponse = (reader, length) => {
      const code = reader.int32();
      const message = {
        name: "authenticationOk",
        length
      };
      switch (code) {
        case 0:
          break;
        case 3:
          if (message.length === 8) {
            message.name = "authenticationCleartextPassword";
          }
          break;
        case 5:
          if (message.length === 12) {
            message.name = "authenticationMD5Password";
            const salt = reader.bytes(4);
            return new messages_1.AuthenticationMD5Password(LATEINIT_LENGTH, salt);
          }
          break;
        case 10:
          {
            message.name = "authenticationSASL";
            message.mechanisms = [];
            let mechanism;
            do {
              mechanism = reader.cstring();
              if (mechanism) {
                message.mechanisms.push(mechanism);
              }
            } while (mechanism);
          }
          break;
        case 11:
          message.name = "authenticationSASLContinue";
          message.data = reader.string(length - 8);
          break;
        case 12:
          message.name = "authenticationSASLFinal";
          message.data = reader.string(length - 8);
          break;
        default:
          throw new Error("Unknown authenticationOk message type " + code);
      }
      return message;
    };
    var parseErrorMessage = (reader, name) => {
      const fields = {};
      let fieldType = reader.string(1);
      while (fieldType !== "\0") {
        fields[fieldType] = reader.cstring();
        fieldType = reader.string(1);
      }
      const messageValue = fields.M;
      const message = name === "notice" ? new messages_1.NoticeMessage(LATEINIT_LENGTH, messageValue) : new messages_1.DatabaseError(messageValue, LATEINIT_LENGTH, name);
      message.severity = fields.S;
      message.code = fields.C;
      message.detail = fields.D;
      message.hint = fields.H;
      message.position = fields.P;
      message.internalPosition = fields.p;
      message.internalQuery = fields.q;
      message.where = fields.W;
      message.schema = fields.s;
      message.table = fields.t;
      message.column = fields.c;
      message.dataType = fields.d;
      message.constraint = fields.n;
      message.file = fields.F;
      message.line = fields.L;
      message.routine = fields.R;
      return message;
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js
var require_dist = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.DatabaseError = exports2.serialize = void 0;
    exports2.parse = parse2;
    var messages_1 = require_messages();
    Object.defineProperty(exports2, "DatabaseError", { enumerable: true, get: function() {
      return messages_1.DatabaseError;
    } });
    var serializer_1 = require_serializer();
    Object.defineProperty(exports2, "serialize", { enumerable: true, get: function() {
      return serializer_1.serialize;
    } });
    var parser_1 = require_parser();
    function parse2(stream, callback) {
      const parser = new parser_1.Parser();
      stream.on("data", (buffer) => parser.parse(buffer, callback));
      return new Promise((resolve2) => stream.on("end", () => resolve2()));
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-cloudflare@1.4.0/node_modules/pg-cloudflare/dist/empty.js
var require_empty = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-cloudflare@1.4.0/node_modules/pg-cloudflare/dist/empty.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = {};
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/stream.js
var require_stream = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/stream.js"(exports2, module2) {
    var { getStream, getSecureStream } = getStreamFuncs();
    module2.exports = {
      /**
       * Get a socket stream compatible with the current runtime environment.
       * @returns {Duplex}
       */
      getStream,
      /**
       * Get a TLS secured socket, compatible with the current environment,
       * using the socket and other settings given in `options`.
       * @returns {Duplex}
       */
      getSecureStream
    };
    function getNodejsStreamFuncs() {
      function getStream2(ssl) {
        const net = require("net");
        return new net.Socket();
      }
      function getSecureStream2(options) {
        const tls = require("tls");
        return tls.connect(options);
      }
      return {
        getStream: getStream2,
        getSecureStream: getSecureStream2
      };
    }
    function getCloudflareStreamFuncs() {
      function getStream2(ssl) {
        const { CloudflareSocket } = require_empty();
        return new CloudflareSocket(ssl);
      }
      function getSecureStream2(options) {
        options.socket.startTls(options);
        return options.socket;
      }
      return {
        getStream: getStream2,
        getSecureStream: getSecureStream2
      };
    }
    function isCloudflareRuntime() {
      if (typeof navigator === "object" && navigator !== null && typeof navigator.userAgent === "string") {
        return navigator.userAgent === "Cloudflare-Workers";
      }
      if (typeof Response === "function") {
        const resp = new Response(null, { cf: { thing: true } });
        if (typeof resp.cf === "object" && resp.cf !== null && resp.cf.thing) {
          return true;
        }
      }
      return false;
    }
    function getStreamFuncs() {
      if (isCloudflareRuntime()) {
        return getCloudflareStreamFuncs();
      }
      return getNodejsStreamFuncs();
    }
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection.js
var require_connection = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events").EventEmitter;
    var { parse: parse2, serialize } = require_dist();
    var stream = require_stream();
    var { getStream } = stream;
    var flushBuffer = serialize.flush();
    var syncBuffer = serialize.sync();
    var endBuffer = serialize.end();
    var Connection2 = class extends EventEmitter {
      constructor(config) {
        super();
        config = config || {};
        this.stream = config.stream || getStream(config.ssl);
        if (typeof this.stream === "function") {
          this.stream = this.stream(config);
        }
        this._keepAlive = config.keepAlive;
        this._keepAliveInitialDelayMillis = config.keepAliveInitialDelayMillis;
        this.parsedStatements = {};
        this.ssl = config.ssl || false;
        this.sslNegotiation = config.sslNegotiation || "postgres";
        this._ending = false;
        this._emitMessage = false;
        const self = this;
        this.on("newListener", function(eventName) {
          if (eventName === "message") {
            self._emitMessage = true;
          }
        });
      }
      connect(port2, host) {
        const self = this;
        this._connecting = true;
        this.stream.setNoDelay(true);
        this.stream.connect(port2, host);
        this.stream.once("connect", function() {
          if (self._keepAlive) {
            self.stream.setKeepAlive(true, self._keepAliveInitialDelayMillis);
          }
          self.emit("connect");
        });
        const reportStreamError = function(error) {
          if (self._ending && (error.code === "ECONNRESET" || error.code === "EPIPE")) {
            return;
          }
          self.emit("error", error);
        };
        this.stream.on("error", reportStreamError);
        this.stream.on("close", function() {
          self.emit("end");
        });
        if (!this.ssl) {
          return this.attachListeners(this.stream);
        }
        if (this.sslNegotiation === "direct") {
          return this.stream.once("connect", function() {
            self.upgradeToSSL(host, reportStreamError);
          });
        }
        this.stream.once("data", function(buffer) {
          const responseCode = buffer.toString("utf8");
          switch (responseCode) {
            case "S":
              break;
            case "N":
              self.stream.end();
              return self.emit("error", new Error("The server does not support SSL connections"));
            default:
              self.stream.end();
              return self.emit("error", new Error("There was an error establishing an SSL connection"));
          }
          self.upgradeToSSL(host, reportStreamError);
        });
      }
      upgradeToSSL(host, reportStreamError) {
        const self = this;
        const options = {
          socket: self.stream
        };
        if (self.ssl !== true) {
          Object.assign(options, self.ssl);
          if ("key" in self.ssl) {
            options.key = self.ssl.key;
          }
        }
        if (self.sslNegotiation === "direct") {
          options.ALPNProtocols = ["postgresql"];
        }
        const net = require("net");
        if (net.isIP && net.isIP(host) === 0) {
          options.servername = host;
        }
        try {
          self.stream = stream.getSecureStream(options);
        } catch (err) {
          return self.emit("error", err);
        }
        self.attachListeners(self.stream);
        self.stream.on("error", reportStreamError);
        self.emit("sslconnect");
      }
      attachListeners(stream2) {
        parse2(stream2, (msg) => {
          const eventName = msg.name === "error" ? "errorMessage" : msg.name;
          if (this._emitMessage) {
            this.emit("message", msg);
          }
          this.emit(eventName, msg);
        });
      }
      requestSsl() {
        this.stream.write(serialize.requestSsl());
      }
      startup(config) {
        this.stream.write(serialize.startup(config));
      }
      cancel(processID, secretKey) {
        this._send(serialize.cancel(processID, secretKey));
      }
      password(password) {
        this._send(serialize.password(password));
      }
      sendSASLInitialResponseMessage(mechanism, initialResponse) {
        this._send(serialize.sendSASLInitialResponseMessage(mechanism, initialResponse));
      }
      sendSCRAMClientFinalMessage(additionalData) {
        this._send(serialize.sendSCRAMClientFinalMessage(additionalData));
      }
      _send(buffer) {
        if (!this.stream.writable) {
          return false;
        }
        return this.stream.write(buffer);
      }
      query(text2) {
        this._send(serialize.query(text2));
      }
      // send parse message
      parse(query) {
        this._send(serialize.parse(query));
      }
      // send bind message
      bind(config) {
        this._send(serialize.bind(config));
      }
      // send execute message
      execute(config) {
        this._send(serialize.execute(config));
      }
      flush() {
        if (this.stream.writable) {
          this.stream.write(flushBuffer);
        }
      }
      sync() {
        this._ending = true;
        this._send(syncBuffer);
      }
      ref() {
        this.stream.ref();
      }
      unref() {
        this.stream.unref();
      }
      end() {
        this._ending = true;
        if (!this._connecting || !this.stream.writable) {
          this.stream.end();
          return;
        }
        return this.stream.write(endBuffer, () => {
          this.stream.end();
        });
      }
      close(msg) {
        this._send(serialize.close(msg));
      }
      describe(msg) {
        this._send(serialize.describe(msg));
      }
      sendCopyFromChunk(chunk) {
        this._send(serialize.copyData(chunk));
      }
      endCopyFrom() {
        this._send(serialize.copyDone());
      }
      sendCopyFail(msg) {
        this._send(serialize.copyFail(msg));
      }
    };
    module2.exports = Connection2;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/split2@4.2.0/node_modules/split2/index.js
var require_split2 = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/split2@4.2.0/node_modules/split2/index.js"(exports2, module2) {
    "use strict";
    var { Transform } = require("stream");
    var { StringDecoder } = require("string_decoder");
    var kLast = Symbol("last");
    var kDecoder = Symbol("decoder");
    function transform(chunk, enc, cb) {
      let list;
      if (this.overflow) {
        const buf = this[kDecoder].write(chunk);
        list = buf.split(this.matcher);
        if (list.length === 1) return cb();
        list.shift();
        this.overflow = false;
      } else {
        this[kLast] += this[kDecoder].write(chunk);
        list = this[kLast].split(this.matcher);
      }
      this[kLast] = list.pop();
      for (let i = 0; i < list.length; i++) {
        try {
          push(this, this.mapper(list[i]));
        } catch (error) {
          return cb(error);
        }
      }
      this.overflow = this[kLast].length > this.maxLength;
      if (this.overflow && !this.skipOverflow) {
        cb(new Error("maximum buffer reached"));
        return;
      }
      cb();
    }
    function flush(cb) {
      this[kLast] += this[kDecoder].end();
      if (this[kLast]) {
        try {
          push(this, this.mapper(this[kLast]));
        } catch (error) {
          return cb(error);
        }
      }
      cb();
    }
    function push(self, val) {
      if (val !== void 0) {
        self.push(val);
      }
    }
    function noop(incoming) {
      return incoming;
    }
    function split(matcher, mapper, options) {
      matcher = matcher || /\r?\n/;
      mapper = mapper || noop;
      options = options || {};
      switch (arguments.length) {
        case 1:
          if (typeof matcher === "function") {
            mapper = matcher;
            matcher = /\r?\n/;
          } else if (typeof matcher === "object" && !(matcher instanceof RegExp) && !matcher[Symbol.split]) {
            options = matcher;
            matcher = /\r?\n/;
          }
          break;
        case 2:
          if (typeof matcher === "function") {
            options = mapper;
            mapper = matcher;
            matcher = /\r?\n/;
          } else if (typeof mapper === "object") {
            options = mapper;
            mapper = noop;
          }
      }
      options = Object.assign({}, options);
      options.autoDestroy = true;
      options.transform = transform;
      options.flush = flush;
      options.readableObjectMode = true;
      const stream = new Transform(options);
      stream[kLast] = "";
      stream[kDecoder] = new StringDecoder("utf8");
      stream.matcher = matcher;
      stream.mapper = mapper;
      stream.maxLength = options.maxLength;
      stream.skipOverflow = options.skipOverflow || false;
      stream.overflow = false;
      stream._destroy = function(err, cb) {
        this._writableState.errorEmitted = false;
        cb(err);
      };
      return stream;
    }
    module2.exports = split;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/helper.js
var require_helper = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/helper.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var Stream = require("stream").Stream;
    var split = require_split2();
    var util2 = require("util");
    var defaultPort = 5432;
    var isWin = process.platform === "win32";
    var warnStream = process.stderr;
    var S_IRWXG = 56;
    var S_IRWXO = 7;
    var S_IFMT = 61440;
    var S_IFREG = 32768;
    function isRegFile(mode) {
      return (mode & S_IFMT) == S_IFREG;
    }
    var fieldNames = ["host", "port", "database", "user", "password"];
    var nrOfFields = fieldNames.length;
    var passKey = fieldNames[nrOfFields - 1];
    function warn() {
      var isWritable = warnStream instanceof Stream && true === warnStream.writable;
      if (isWritable) {
        var args = Array.prototype.slice.call(arguments).concat("\n");
        warnStream.write(util2.format.apply(util2, args));
      }
    }
    Object.defineProperty(module2.exports, "isWin", {
      get: function() {
        return isWin;
      },
      set: function(val) {
        isWin = val;
      }
    });
    module2.exports.warnTo = function(stream) {
      var old = warnStream;
      warnStream = stream;
      return old;
    };
    module2.exports.getFileName = function(rawEnv) {
      var env = rawEnv || process.env;
      var file = env.PGPASSFILE || (isWin ? path2.join(env.APPDATA || "./", "postgresql", "pgpass.conf") : path2.join(env.HOME || "./", ".pgpass"));
      return file;
    };
    module2.exports.usePgPass = function(stats, fname) {
      if (Object.prototype.hasOwnProperty.call(process.env, "PGPASSWORD")) {
        return false;
      }
      if (isWin) {
        return true;
      }
      fname = fname || "<unkn>";
      if (!isRegFile(stats.mode)) {
        warn('WARNING: password file "%s" is not a plain file', fname);
        return false;
      }
      if (stats.mode & (S_IRWXG | S_IRWXO)) {
        warn('WARNING: password file "%s" has group or world access; permissions should be u=rw (0600) or less', fname);
        return false;
      }
      return true;
    };
    var matcher = module2.exports.match = function(connInfo, entry) {
      return fieldNames.slice(0, -1).reduce(function(prev, field, idx) {
        if (idx == 1) {
          if (Number(connInfo[field] || defaultPort) === Number(entry[field])) {
            return prev && true;
          }
        }
        return prev && (entry[field] === "*" || entry[field] === connInfo[field]);
      }, true);
    };
    module2.exports.getPassword = function(connInfo, stream, cb) {
      var pass;
      var lineStream = stream.pipe(split());
      function onLine(line) {
        var entry = parseLine(line);
        if (entry && isValidEntry(entry) && matcher(connInfo, entry)) {
          pass = entry[passKey];
          lineStream.end();
        }
      }
      var onEnd = function() {
        stream.destroy();
        cb(pass);
      };
      var onErr = function(err) {
        stream.destroy();
        warn("WARNING: error on reading file: %s", err);
        cb(void 0);
      };
      stream.on("error", onErr);
      lineStream.on("data", onLine).on("end", onEnd).on("error", onErr);
    };
    var parseLine = module2.exports.parseLine = function(line) {
      if (line.length < 11 || line.match(/^\s+#/)) {
        return null;
      }
      var curChar = "";
      var prevChar = "";
      var fieldIdx = 0;
      var startIdx = 0;
      var endIdx = 0;
      var obj = {};
      var isLastField = false;
      var addToObj = function(idx, i0, i1) {
        var field = line.substring(i0, i1);
        if (!Object.hasOwnProperty.call(process.env, "PGPASS_NO_DEESCAPE")) {
          field = field.replace(/\\([:\\])/g, "$1");
        }
        obj[fieldNames[idx]] = field;
      };
      for (var i = 0; i < line.length - 1; i += 1) {
        curChar = line.charAt(i + 1);
        prevChar = line.charAt(i);
        isLastField = fieldIdx == nrOfFields - 1;
        if (isLastField) {
          addToObj(fieldIdx, startIdx);
          break;
        }
        if (i >= 0 && curChar == ":" && prevChar !== "\\") {
          addToObj(fieldIdx, startIdx, i + 1);
          startIdx = i + 2;
          fieldIdx += 1;
        }
      }
      obj = Object.keys(obj).length === nrOfFields ? obj : null;
      return obj;
    };
    var isValidEntry = module2.exports.isValidEntry = function(entry) {
      var rules = {
        // host
        0: function(x) {
          return x.length > 0;
        },
        // port
        1: function(x) {
          if (x === "*") {
            return true;
          }
          x = Number(x);
          return isFinite(x) && x > 0 && x < 9007199254740992 && Math.floor(x) === x;
        },
        // database
        2: function(x) {
          return x.length > 0;
        },
        // username
        3: function(x) {
          return x.length > 0;
        },
        // password
        4: function(x) {
          return x.length > 0;
        }
      };
      for (var idx = 0; idx < fieldNames.length; idx += 1) {
        var rule = rules[idx];
        var value = entry[fieldNames[idx]] || "";
        var res = rule(value);
        if (!res) {
          return false;
        }
      }
      return true;
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/index.js
var require_lib = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pgpass@1.0.5/node_modules/pgpass/lib/index.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var fs2 = require("fs");
    var helper = require_helper();
    module2.exports = function(connInfo, cb) {
      var file = helper.getFileName();
      fs2.stat(file, function(err, stat) {
        if (err || !helper.usePgPass(stat, file)) {
          return cb(void 0);
        }
        var st = fs2.createReadStream(file);
        helper.getPassword(connInfo, st, cb);
      });
    };
    module2.exports.warnTo = helper.warnTo;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js
var require_client = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js"(exports2, module2) {
    var EventEmitter = require("events").EventEmitter;
    var utils = require_utils();
    var nodeUtils = require("util");
    var sasl = require_sasl();
    var TypeOverrides2 = require_type_overrides();
    var ConnectionParameters = require_connection_parameters();
    var Query2 = require_query();
    var defaults3 = require_defaults();
    var Connection2 = require_connection();
    var crypto = require_utils2();
    var activeQueryDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Client.activeQuery is deprecated and will be removed in pg@9.0"
    );
    var queryQueueDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Client.queryQueue is deprecated and will be removed in pg@9.0."
    );
    var pgPassDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "pgpass support is deprecated and will be removed in pg@9.0. You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code."
    );
    var byoPromiseDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Passing a custom Promise implementation to the Client/Pool constructor is deprecated and will be removed in pg@9.0."
    );
    var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead."
    );
    function coerceNumberOrDefault(value, defaultValue) {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : defaultValue;
      }
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : defaultValue;
      }
      return defaultValue;
    }
    var Client2 = class extends EventEmitter {
      constructor(config) {
        super();
        this.connectionParameters = new ConnectionParameters(config);
        this.user = this.connectionParameters.user;
        this.database = this.connectionParameters.database;
        this.port = this.connectionParameters.port;
        this.host = this.connectionParameters.host;
        Object.defineProperty(this, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: this.connectionParameters.password
        });
        this.replication = this.connectionParameters.replication;
        const c = config || {};
        if (c.Promise) {
          byoPromiseDeprecationNotice();
        }
        this._Promise = c.Promise || global.Promise;
        this._types = new TypeOverrides2(c.types);
        this._ending = false;
        this._ended = false;
        this._connecting = false;
        this._connected = false;
        this._connectionError = false;
        this._queryable = true;
        this._activeQuery = null;
        this._txStatus = null;
        this.enableChannelBinding = Boolean(c.enableChannelBinding);
        this.scramMaxIterations = coerceNumberOrDefault(c.scramMaxIterations, sasl.DEFAULT_MAX_SCRAM_ITERATIONS);
        this.connection = c.connection || new Connection2({
          stream: c.stream,
          ssl: this.connectionParameters.ssl,
          sslNegotiation: this.connectionParameters.sslnegotiation,
          keepAlive: c.keepAlive || false,
          keepAliveInitialDelayMillis: c.keepAliveInitialDelayMillis || 0,
          encoding: this.connectionParameters.client_encoding || "utf8"
        });
        this._queryQueue = [];
        this.binary = c.binary || defaults3.binary;
        this.processID = null;
        this.secretKey = null;
        this.ssl = this.connectionParameters.ssl || false;
        this.sslNegotiation = this.connectionParameters.sslnegotiation || "postgres";
        if (this.ssl && this.ssl.key) {
          Object.defineProperty(this.ssl, "key", {
            enumerable: false
          });
        }
        this._connectionTimeoutMillis = c.connectionTimeoutMillis || 0;
      }
      get activeQuery() {
        activeQueryDeprecationNotice();
        return this._activeQuery;
      }
      set activeQuery(val) {
        activeQueryDeprecationNotice();
        this._activeQuery = val;
      }
      _getActiveQuery() {
        return this._activeQuery;
      }
      _errorAllQueries(err) {
        const enqueueError = (query) => {
          process.nextTick(() => {
            query.handleError(err, this.connection);
          });
        };
        const activeQuery = this._getActiveQuery();
        if (activeQuery) {
          enqueueError(activeQuery);
          this._activeQuery = null;
        }
        this._queryQueue.forEach(enqueueError);
        this._queryQueue.length = 0;
      }
      _connect(callback) {
        const self = this;
        const con = this.connection;
        this._connectionCallback = callback;
        if (this._connecting || this._connected) {
          const err = new Error("Client has already been connected. You cannot reuse a client.");
          process.nextTick(() => {
            callback(err);
          });
          return;
        }
        this._connecting = true;
        if (this._connectionTimeoutMillis > 0) {
          this.connectionTimeoutHandle = setTimeout(() => {
            con._ending = true;
            con.stream.destroy(new Error("timeout expired"));
          }, this._connectionTimeoutMillis);
          if (this.connectionTimeoutHandle.unref) {
            this.connectionTimeoutHandle.unref();
          }
        }
        if (this.host && this.host.indexOf("/") === 0) {
          con.connect(this.host + "/.s.PGSQL." + this.port);
        } else {
          con.connect(this.port, this.host);
        }
        con.on("connect", function() {
          if (self.ssl) {
            if (self.sslNegotiation !== "direct") {
              con.requestSsl();
            }
          } else {
            con.startup(self.getStartupConf());
          }
        });
        con.on("sslconnect", function() {
          con.startup(self.getStartupConf());
        });
        this._attachListeners(con);
        con.once("end", () => {
          const error = this._ending ? new Error("Connection terminated") : new Error("Connection terminated unexpectedly");
          clearTimeout(this.connectionTimeoutHandle);
          this._errorAllQueries(error);
          this._ended = true;
          if (!this._ending) {
            if (this._connecting && !this._connectionError) {
              if (this._connectionCallback) {
                this._connectionCallback(error);
              } else {
                this._handleErrorEvent(error);
              }
            } else if (!this._connectionError) {
              this._handleErrorEvent(error);
            }
          }
          process.nextTick(() => {
            this.emit("end");
          });
        });
      }
      connect(callback) {
        if (callback) {
          this._connect(callback);
          return;
        }
        return new this._Promise((resolve2, reject3) => {
          this._connect((error) => {
            if (error) {
              reject3(error);
            } else {
              resolve2(this);
            }
          });
        });
      }
      _attachListeners(con) {
        con.on("authenticationCleartextPassword", this._handleAuthCleartextPassword.bind(this));
        con.on("authenticationMD5Password", this._handleAuthMD5Password.bind(this));
        con.on("authenticationSASL", this._handleAuthSASL.bind(this));
        con.on("authenticationSASLContinue", this._handleAuthSASLContinue.bind(this));
        con.on("authenticationSASLFinal", this._handleAuthSASLFinal.bind(this));
        con.on("backendKeyData", this._handleBackendKeyData.bind(this));
        con.on("error", this._handleErrorEvent.bind(this));
        con.on("errorMessage", this._handleErrorMessage.bind(this));
        con.on("readyForQuery", this._handleReadyForQuery.bind(this));
        con.on("notice", this._handleNotice.bind(this));
        con.on("rowDescription", this._handleRowDescription.bind(this));
        con.on("dataRow", this._handleDataRow.bind(this));
        con.on("portalSuspended", this._handlePortalSuspended.bind(this));
        con.on("emptyQuery", this._handleEmptyQuery.bind(this));
        con.on("commandComplete", this._handleCommandComplete.bind(this));
        con.on("parseComplete", this._handleParseComplete.bind(this));
        con.on("copyInResponse", this._handleCopyInResponse.bind(this));
        con.on("copyData", this._handleCopyData.bind(this));
        con.on("notification", this._handleNotification.bind(this));
      }
      _getPassword(cb) {
        const con = this.connection;
        if (typeof this.password === "function") {
          this._Promise.resolve().then(() => this.password(this.connectionParameters)).then((pass) => {
            if (pass !== void 0) {
              if (typeof pass !== "string") {
                con.emit("error", new TypeError("Password must be a string"));
                return;
              }
              this.connectionParameters.password = this.password = pass;
            } else {
              this.connectionParameters.password = this.password = null;
            }
            cb();
          }).catch((err) => {
            con.emit("error", err);
          });
        } else if (this.password !== null) {
          cb();
        } else {
          try {
            const pgPass = require_lib();
            pgPass(this.connectionParameters, (pass) => {
              if (void 0 !== pass) {
                pgPassDeprecationNotice();
                this.connectionParameters.password = this.password = pass;
              }
              cb();
            });
          } catch (e) {
            this.emit("error", e);
          }
        }
      }
      _handleAuthCleartextPassword(msg) {
        this._getPassword(() => {
          this.connection.password(this.password);
        });
      }
      _handleAuthMD5Password(msg) {
        this._getPassword(async () => {
          try {
            const hashedPassword = await crypto.postgresMd5PasswordHash(this.user, this.password, msg.salt);
            this.connection.password(hashedPassword);
          } catch (e) {
            this.emit("error", e);
          }
        });
      }
      _handleAuthSASL(msg) {
        this._getPassword(() => {
          try {
            this.saslSession = sasl.startSession(
              msg.mechanisms,
              this.enableChannelBinding && this.connection.stream,
              this.scramMaxIterations
            );
            this.connection.sendSASLInitialResponseMessage(this.saslSession.mechanism, this.saslSession.response);
          } catch (err) {
            this.connection.emit("error", err);
          }
        });
      }
      async _handleAuthSASLContinue(msg) {
        try {
          await sasl.continueSession(
            this.saslSession,
            this.password,
            msg.data,
            this.enableChannelBinding && this.connection.stream
          );
          this.connection.sendSCRAMClientFinalMessage(this.saslSession.response);
        } catch (err) {
          this.connection.emit("error", err);
        }
      }
      _handleAuthSASLFinal(msg) {
        try {
          sasl.finalizeSession(this.saslSession, msg.data);
          this.saslSession = null;
        } catch (err) {
          this.connection.emit("error", err);
        }
      }
      _handleBackendKeyData(msg) {
        this.processID = msg.processID;
        this.secretKey = msg.secretKey;
      }
      _handleReadyForQuery(msg) {
        if (this._connecting) {
          this._connecting = false;
          this._connected = true;
          clearTimeout(this.connectionTimeoutHandle);
          if (this._connectionCallback) {
            this._connectionCallback(null, this);
            this._connectionCallback = null;
          }
          this.emit("connect");
        }
        const activeQuery = this._getActiveQuery();
        this._activeQuery = null;
        this._txStatus = msg?.status ?? null;
        this.readyForQuery = true;
        if (activeQuery) {
          activeQuery.handleReadyForQuery(this.connection);
        }
        this._pulseQueryQueue();
      }
      // if we receive an error event or error message
      // during the connection process we handle it here
      _handleErrorWhileConnecting(err) {
        if (this._connectionError) {
          return;
        }
        this._connectionError = true;
        clearTimeout(this.connectionTimeoutHandle);
        if (this._connectionCallback) {
          return this._connectionCallback(err);
        }
        this.emit("error", err);
      }
      // if we're connected and we receive an error event from the connection
      // this means the socket is dead - do a hard abort of all queries and emit
      // the socket error on the client as well
      _handleErrorEvent(err) {
        if (this._connecting) {
          return this._handleErrorWhileConnecting(err);
        }
        this._queryable = false;
        this._errorAllQueries(err);
        this.emit("error", err);
      }
      // handle error messages from the postgres backend
      _handleErrorMessage(msg) {
        if (this._connecting) {
          return this._handleErrorWhileConnecting(msg);
        }
        const activeQuery = this._getActiveQuery();
        if (!activeQuery) {
          this._handleErrorEvent(msg);
          return;
        }
        this._activeQuery = null;
        activeQuery.handleError(msg, this.connection);
      }
      _handleRowDescription(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected rowDescription message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleRowDescription(msg);
      }
      _handleDataRow(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected dataRow message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleDataRow(msg);
      }
      _handlePortalSuspended(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected portalSuspended message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handlePortalSuspended(this.connection);
      }
      _handleEmptyQuery(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected emptyQuery message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleEmptyQuery(this.connection);
      }
      _handleCommandComplete(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected commandComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCommandComplete(msg, this.connection);
      }
      _handleParseComplete() {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected parseComplete message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        if (activeQuery.name) {
          this.connection.parsedStatements[activeQuery.name] = activeQuery.text;
        }
      }
      _handleCopyInResponse(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected copyInResponse message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCopyInResponse(this.connection);
      }
      _handleCopyData(msg) {
        const activeQuery = this._getActiveQuery();
        if (activeQuery == null) {
          const error = new Error("Received unexpected copyData message from backend.");
          this._handleErrorEvent(error);
          return;
        }
        activeQuery.handleCopyData(msg, this.connection);
      }
      _handleNotification(msg) {
        this.emit("notification", msg);
      }
      _handleNotice(msg) {
        this.emit("notice", msg);
      }
      getStartupConf() {
        const params = this.connectionParameters;
        const data = {
          user: params.user,
          database: params.database
        };
        const appName = params.application_name || params.fallback_application_name;
        if (appName) {
          data.application_name = appName;
        }
        if (params.replication) {
          data.replication = "" + params.replication;
        }
        if (params.statement_timeout) {
          data.statement_timeout = String(parseInt(params.statement_timeout, 10));
        }
        if (params.lock_timeout) {
          data.lock_timeout = String(parseInt(params.lock_timeout, 10));
        }
        if (params.idle_in_transaction_session_timeout) {
          data.idle_in_transaction_session_timeout = String(parseInt(params.idle_in_transaction_session_timeout, 10));
        }
        if (params.options) {
          data.options = params.options;
        }
        return data;
      }
      cancel(client, query) {
        if (client.activeQuery === query) {
          const con = this.connection;
          if (this.host && this.host.indexOf("/") === 0) {
            con.connect(this.host + "/.s.PGSQL." + this.port);
          } else {
            con.connect(this.port, this.host);
          }
          con.on("connect", function() {
            con.cancel(client.processID, client.secretKey);
          });
        } else if (client._queryQueue.indexOf(query) !== -1) {
          client._queryQueue.splice(client._queryQueue.indexOf(query), 1);
        }
      }
      setTypeParser(oid, format, parseFn) {
        return this._types.setTypeParser(oid, format, parseFn);
      }
      getTypeParser(oid, format) {
        return this._types.getTypeParser(oid, format);
      }
      // escapeIdentifier and escapeLiteral moved to utility functions & exported
      // on PG
      // re-exported here for backwards compatibility
      escapeIdentifier(str) {
        return utils.escapeIdentifier(str);
      }
      escapeLiteral(str) {
        return utils.escapeLiteral(str);
      }
      _pulseQueryQueue() {
        if (this.readyForQuery === true) {
          this._activeQuery = this._queryQueue.shift();
          const activeQuery = this._getActiveQuery();
          if (activeQuery) {
            this.readyForQuery = false;
            this.hasExecuted = true;
            const queryError = activeQuery.submit(this.connection);
            if (queryError) {
              process.nextTick(() => {
                activeQuery.handleError(queryError, this.connection);
                this.readyForQuery = true;
                this._pulseQueryQueue();
              });
            }
          } else if (this.hasExecuted) {
            this._activeQuery = null;
            this.emit("drain");
          }
        }
      }
      query(config, values, callback) {
        let query;
        let result;
        if (config == null) {
          throw new TypeError("Client was passed a null or undefined query");
        }
        if (typeof config.submit === "function") {
          result = query = config;
          if (!query.callback) {
            if (typeof values === "function") {
              query.callback = values;
            } else if (callback) {
              query.callback = callback;
            }
          }
        } else {
          query = new Query2(config, values, callback);
          if (!query.callback) {
            result = new this._Promise((resolve2, reject3) => {
              query.callback = (err, res) => err ? reject3(err) : resolve2(res);
            }).catch((err) => {
              Error.captureStackTrace(err);
              throw err;
            });
          } else if (typeof query.callback !== "function") {
            throw new TypeError("callback is not a function");
          }
        }
        const readTimeout = config.query_timeout || this.connectionParameters.query_timeout;
        if (readTimeout) {
          const queryCallback = query.callback || (() => {
          });
          const readTimeoutTimer = setTimeout(() => {
            const error = new Error("Query read timeout");
            process.nextTick(() => {
              query.handleError(error, this.connection);
            });
            queryCallback(error);
            query.callback = () => {
            };
            const index = this._queryQueue.indexOf(query);
            if (index > -1) {
              this._queryQueue.splice(index, 1);
            }
            this._pulseQueryQueue();
          }, readTimeout);
          query.callback = (err, res) => {
            clearTimeout(readTimeoutTimer);
            queryCallback(err, res);
          };
        }
        if (this.binary && !query.binary) {
          query.binary = true;
        }
        if (query._result && !query._result._types) {
          query._result._types = this._types;
        }
        if (!this._queryable) {
          process.nextTick(() => {
            query.handleError(new Error("Client has encountered a connection error and is not queryable"), this.connection);
          });
          return result;
        }
        if (this._ending) {
          process.nextTick(() => {
            query.handleError(new Error("Client was closed and is not queryable"), this.connection);
          });
          return result;
        }
        if (this._queryQueue.length > 0) {
          queryQueueLengthDeprecationNotice();
        }
        this._queryQueue.push(query);
        this._pulseQueryQueue();
        return result;
      }
      ref() {
        this.connection.ref();
      }
      unref() {
        this.connection.unref();
      }
      getTransactionStatus() {
        return this._txStatus;
      }
      end(cb) {
        this._ending = true;
        if (!this.connection._connecting || this._ended) {
          if (cb) {
            cb();
            return;
          } else {
            return this._Promise.resolve();
          }
        }
        if (this._getActiveQuery() || !this._queryable) {
          this.connection.stream.destroy();
        } else {
          this.connection.end();
        }
        if (cb) {
          this.connection.once("end", cb);
        } else {
          return new this._Promise((resolve2) => {
            this.connection.once("end", resolve2);
          });
        }
      }
      get queryQueue() {
        queryQueueDeprecationNotice();
        return this._queryQueue;
      }
    };
    Client2.Query = Query2;
    module2.exports = Client2;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-pool@3.14.0_pg@8.22.0/node_modules/pg-pool/index.js
var require_pg_pool = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg-pool@3.14.0_pg@8.22.0/node_modules/pg-pool/index.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events").EventEmitter;
    var NOOP = function() {
    };
    var removeWhere = (list, predicate) => {
      const i = list.findIndex(predicate);
      return i === -1 ? void 0 : list.splice(i, 1)[0];
    };
    var IdleItem = class {
      constructor(client, idleListener, timeoutId) {
        this.client = client;
        this.idleListener = idleListener;
        this.timeoutId = timeoutId;
      }
    };
    var PendingItem = class {
      constructor(callback) {
        this.callback = callback;
      }
    };
    function throwOnDoubleRelease() {
      throw new Error("Release called on client which has already been released to the pool.");
    }
    function promisify2(Promise2, callback) {
      if (callback) {
        return { callback, result: void 0 };
      }
      let rej;
      let res;
      const cb = function(err, client) {
        err ? rej(err) : res(client);
      };
      const result = new Promise2(function(resolve2, reject3) {
        res = resolve2;
        rej = reject3;
      }).catch((err) => {
        Error.captureStackTrace(err);
        throw err;
      });
      return { callback: cb, result };
    }
    function makeIdleListener(pool, client) {
      return function idleListener(err) {
        err.client = client;
        client.removeListener("error", idleListener);
        client.on("error", () => {
          pool.log("additional client error after disconnection due to error", err);
        });
        pool._remove(client);
        pool.emit("error", err, client);
      };
    }
    var Pool2 = class extends EventEmitter {
      constructor(options, Client2) {
        super();
        this.options = Object.assign({}, options);
        if (options != null && "password" in options) {
          Object.defineProperty(this.options, "password", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: options.password
          });
        }
        if (options != null && options.ssl && options.ssl.key) {
          Object.defineProperty(this.options.ssl, "key", {
            enumerable: false
          });
        }
        this.options.max = this.options.max || this.options.poolSize || 10;
        this.options.min = this.options.min || 0;
        this.options.maxUses = this.options.maxUses || Infinity;
        this.options.allowExitOnIdle = this.options.allowExitOnIdle || false;
        this.options.maxLifetimeSeconds = this.options.maxLifetimeSeconds || 0;
        this.log = this.options.log || function() {
        };
        this.Client = this.options.Client || Client2 || require_lib2().Client;
        this.Promise = this.options.Promise || global.Promise;
        if (typeof this.options.idleTimeoutMillis === "undefined") {
          this.options.idleTimeoutMillis = 1e4;
        }
        this._clients = [];
        this._idle = [];
        this._expired = /* @__PURE__ */ new WeakSet();
        this._pendingQueue = [];
        this._endCallback = void 0;
        this.ending = false;
        this.ended = false;
      }
      _promiseTry(f) {
        const Promise2 = this.Promise;
        if (typeof Promise2.try === "function") {
          return Promise2.try(f);
        }
        return new Promise2((resolve2) => resolve2(f()));
      }
      _isFull() {
        return this._clients.length >= this.options.max;
      }
      _isAboveMin() {
        return this._clients.length > this.options.min;
      }
      _pulseQueue() {
        this.log("pulse queue");
        if (this.ended) {
          this.log("pulse queue ended");
          return;
        }
        if (this.ending) {
          this.log("pulse queue on ending");
          if (this._idle.length) {
            this._idle.slice().map((item) => {
              this._remove(item.client);
            });
          }
          if (!this._clients.length) {
            this.ended = true;
            this._endCallback();
          }
          return;
        }
        if (!this._pendingQueue.length) {
          this.log("no queued requests");
          return;
        }
        if (!this._idle.length && this._isFull()) {
          return;
        }
        const pendingItem = this._pendingQueue.shift();
        if (this._idle.length) {
          const idleItem = this._idle.pop();
          clearTimeout(idleItem.timeoutId);
          const client = idleItem.client;
          client.ref && client.ref();
          const idleListener = idleItem.idleListener;
          return this._acquireClient(client, pendingItem, idleListener, false);
        }
        if (!this._isFull()) {
          return this.newClient(pendingItem);
        }
        throw new Error("unexpected condition");
      }
      _remove(client, callback) {
        const removed = removeWhere(this._idle, (item) => item.client === client);
        if (removed !== void 0) {
          clearTimeout(removed.timeoutId);
        }
        this._clients = this._clients.filter((c) => c !== client);
        const context = this;
        client.end(() => {
          context.emit("remove", client);
          if (typeof callback === "function") {
            callback();
          }
        });
      }
      connect(cb) {
        if (this.ending) {
          const err = new Error("Cannot use a pool after calling end on the pool");
          return cb ? cb(err) : this.Promise.reject(err);
        }
        const response = promisify2(this.Promise, cb);
        const result = response.result;
        if (this._isFull() || this._idle.length) {
          if (this._idle.length) {
            process.nextTick(() => this._pulseQueue());
          }
          if (!this.options.connectionTimeoutMillis) {
            this._pendingQueue.push(new PendingItem(response.callback));
            return result;
          }
          const queueCallback = (err, res, done) => {
            clearTimeout(tid);
            response.callback(err, res, done);
          };
          const pendingItem = new PendingItem(queueCallback);
          const tid = setTimeout(() => {
            removeWhere(this._pendingQueue, (i) => i.callback === queueCallback);
            pendingItem.timedOut = true;
            response.callback(new Error("timeout exceeded when trying to connect"));
          }, this.options.connectionTimeoutMillis);
          if (tid.unref) {
            tid.unref();
          }
          this._pendingQueue.push(pendingItem);
          return result;
        }
        this.newClient(new PendingItem(response.callback));
        return result;
      }
      newClient(pendingItem) {
        const client = new this.Client(this.options);
        this._clients.push(client);
        const idleListener = makeIdleListener(this, client);
        this.log("checking client timeout");
        let tid;
        let timeoutHit = false;
        if (this.options.connectionTimeoutMillis) {
          tid = setTimeout(() => {
            if (client.connection) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client.connection.stream.destroy();
            } else if (!client.isConnected()) {
              this.log("ending client due to timeout");
              timeoutHit = true;
              client.end();
            }
          }, this.options.connectionTimeoutMillis);
        }
        this.log("connecting new client");
        client.connect((err) => {
          if (tid) {
            clearTimeout(tid);
          }
          client.on("error", idleListener);
          if (err) {
            this.log("client failed to connect", err);
            this._clients = this._clients.filter((c) => c !== client);
            if (timeoutHit) {
              err = new Error("Connection terminated due to connection timeout", { cause: err });
            }
            this._pulseQueue();
            if (!pendingItem.timedOut) {
              pendingItem.callback(err, void 0, NOOP);
            }
          } else {
            this.log("new client connected");
            if (this.options.onConnect) {
              this._promiseTry(() => this.options.onConnect(client)).then(
                () => {
                  this._afterConnect(client, pendingItem, idleListener);
                },
                (hookErr) => {
                  this._clients = this._clients.filter((c) => c !== client);
                  client.end(() => {
                    this._pulseQueue();
                    if (!pendingItem.timedOut) {
                      pendingItem.callback(hookErr, void 0, NOOP);
                    }
                  });
                }
              );
              return;
            }
            return this._afterConnect(client, pendingItem, idleListener);
          }
        });
      }
      _afterConnect(client, pendingItem, idleListener) {
        if (this.options.maxLifetimeSeconds !== 0) {
          const maxLifetimeTimeout = setTimeout(() => {
            this.log("ending client due to expired lifetime");
            this._expired.add(client);
            const idleIndex = this._idle.findIndex((idleItem) => idleItem.client === client);
            if (idleIndex !== -1) {
              this._acquireClient(
                client,
                new PendingItem((err, client2, clientRelease) => clientRelease()),
                idleListener,
                false
              );
            }
          }, this.options.maxLifetimeSeconds * 1e3);
          maxLifetimeTimeout.unref();
          client.once("end", () => clearTimeout(maxLifetimeTimeout));
        }
        return this._acquireClient(client, pendingItem, idleListener, true);
      }
      // acquire a client for a pending work item
      _acquireClient(client, pendingItem, idleListener, isNew) {
        if (isNew) {
          this.emit("connect", client);
        }
        this.emit("acquire", client);
        client.release = this._releaseOnce(client, idleListener);
        client.removeListener("error", idleListener);
        if (!pendingItem.timedOut) {
          if (isNew && this.options.verify) {
            this.options.verify(client, (err) => {
              if (err) {
                client.release(err);
                return pendingItem.callback(err, void 0, NOOP);
              }
              pendingItem.callback(void 0, client, client.release);
            });
          } else {
            pendingItem.callback(void 0, client, client.release);
          }
        } else {
          if (isNew && this.options.verify) {
            this.options.verify(client, client.release);
          } else {
            client.release();
          }
        }
      }
      // returns a function that wraps _release and throws if called more than once
      _releaseOnce(client, idleListener) {
        let released = false;
        return (err) => {
          if (released) {
            throwOnDoubleRelease();
          }
          released = true;
          this._release(client, idleListener, err);
        };
      }
      // release a client back to the poll, include an error
      // to remove it from the pool
      _release(client, idleListener, err) {
        client.on("error", idleListener);
        client._poolUseCount = (client._poolUseCount || 0) + 1;
        this.emit("release", err, client);
        if (err || this.ending || !client._queryable || client._ending || client._poolUseCount >= this.options.maxUses) {
          if (client._poolUseCount >= this.options.maxUses) {
            this.log("remove expended client");
          }
          return this._remove(client, this._pulseQueue.bind(this));
        }
        const isExpired = this._expired.has(client);
        if (isExpired) {
          this.log("remove expired client");
          this._expired.delete(client);
          return this._remove(client, this._pulseQueue.bind(this));
        }
        let tid;
        if (this.options.idleTimeoutMillis && this._isAboveMin()) {
          tid = setTimeout(() => {
            if (this._isAboveMin()) {
              this.log("remove idle client");
              this._remove(client, this._pulseQueue.bind(this));
            }
          }, this.options.idleTimeoutMillis);
          if (this.options.allowExitOnIdle) {
            tid.unref();
          }
        }
        if (this.options.allowExitOnIdle) {
          client.unref();
        }
        this._idle.push(new IdleItem(client, idleListener, tid));
        this._pulseQueue();
      }
      query(text2, values, cb) {
        if (typeof text2 === "function") {
          const response2 = promisify2(this.Promise, text2);
          setImmediate(function() {
            return response2.callback(new Error("Passing a function as the first parameter to pool.query is not supported"));
          });
          return response2.result;
        }
        if (typeof values === "function") {
          cb = values;
          values = void 0;
        }
        const response = promisify2(this.Promise, cb);
        cb = response.callback;
        this.connect((err, client) => {
          if (err) {
            return cb(err);
          }
          let clientReleased = false;
          const onError = (err2) => {
            if (clientReleased) {
              return;
            }
            clientReleased = true;
            client.release(err2);
            cb(err2);
          };
          client.once("error", onError);
          this.log("dispatching query");
          try {
            client.query(text2, values, (err2, res) => {
              this.log("query dispatched");
              client.removeListener("error", onError);
              if (clientReleased) {
                return;
              }
              clientReleased = true;
              client.release(err2);
              if (err2) {
                return cb(err2);
              }
              return cb(void 0, res);
            });
          } catch (err2) {
            client.release(err2);
            return cb(err2);
          }
        });
        return response.result;
      }
      end(cb) {
        this.log("ending");
        if (this.ending) {
          const err = new Error("Called end on pool more than once");
          return cb ? cb(err) : this.Promise.reject(err);
        }
        this.ending = true;
        const promised = promisify2(this.Promise, cb);
        this._endCallback = promised.callback;
        this._pulseQueue();
        return promised.result;
      }
      get waitingCount() {
        return this._pendingQueue.length;
      }
      get idleCount() {
        return this._idle.length;
      }
      get expiredCount() {
        return this._clients.reduce((acc, client) => acc + (this._expired.has(client) ? 1 : 0), 0);
      }
      get totalCount() {
        return this._clients.length;
      }
    };
    module2.exports = Pool2;
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/query.js
var require_query2 = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/query.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events").EventEmitter;
    var util2 = require("util");
    var utils = require_utils();
    var NativeQuery = module2.exports = function(config, values, callback) {
      EventEmitter.call(this);
      config = utils.normalizeQueryConfig(config, values, callback);
      this.text = config.text;
      this.values = config.values;
      this.name = config.name;
      this.queryMode = config.queryMode;
      this.callback = config.callback;
      this.state = "new";
      this._arrayMode = config.rowMode === "array";
      this._emitRowEvents = false;
      this.on(
        "newListener",
        function(event) {
          if (event === "row") this._emitRowEvents = true;
        }.bind(this)
      );
    };
    util2.inherits(NativeQuery, EventEmitter);
    var errorFieldMap = {
      sqlState: "code",
      statementPosition: "position",
      messagePrimary: "message",
      context: "where",
      schemaName: "schema",
      tableName: "table",
      columnName: "column",
      dataTypeName: "dataType",
      constraintName: "constraint",
      sourceFile: "file",
      sourceLine: "line",
      sourceFunction: "routine"
    };
    NativeQuery.prototype.handleError = function(err) {
      const fields = this.native.pq.resultErrorFields();
      if (fields) {
        for (const key in fields) {
          const normalizedFieldName = errorFieldMap[key] || key;
          err[normalizedFieldName] = fields[key];
        }
      }
      if (this.callback) {
        this.callback(err);
      } else {
        this.emit("error", err);
      }
      this.state = "error";
    };
    NativeQuery.prototype.then = function(onSuccess, onFailure) {
      return this._getPromise().then(onSuccess, onFailure);
    };
    NativeQuery.prototype.catch = function(callback) {
      return this._getPromise().catch(callback);
    };
    NativeQuery.prototype._getPromise = function() {
      if (this._promise) return this._promise;
      this._promise = new Promise(
        function(resolve2, reject3) {
          this._once("end", resolve2);
          this._once("error", reject3);
        }.bind(this)
      );
      return this._promise;
    };
    NativeQuery.prototype.submit = function(client) {
      this.state = "running";
      const self = this;
      this.native = client.native;
      client.native.arrayMode = this._arrayMode;
      let after = function(err, rows, results) {
        client.native.arrayMode = false;
        setImmediate(function() {
          self.emit("_done");
        });
        if (err) {
          return self.handleError(err);
        }
        if (self._emitRowEvents) {
          if (results.length > 1) {
            rows.forEach((rowOfRows, i) => {
              rowOfRows.forEach((row2) => {
                self.emit("row", row2, results[i]);
              });
            });
          } else {
            rows.forEach(function(row2) {
              self.emit("row", row2, results);
            });
          }
        }
        self.state = "end";
        self.emit("end", results);
        if (self.callback) {
          self.callback(null, results);
        }
      };
      if (process.domain) {
        after = process.domain.bind(after);
      }
      if (this.name) {
        if (this.name.length > 63) {
          console.error("Warning! Postgres only supports 63 characters for query names.");
          console.error("You supplied %s (%s)", this.name, this.name.length);
          console.error("This can cause conflicts and silent errors executing queries");
        }
        const values = (this.values || []).map(utils.prepareValue);
        if (client.namedQueries[this.name]) {
          if (this.text && client.namedQueries[this.name] !== this.text) {
            const err = new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
            return after(err);
          }
          return client.native.execute(this.name, values, after);
        }
        return client.native.prepare(this.name, this.text, values.length, function(err) {
          if (err) return after(err);
          client.namedQueries[self.name] = self.text;
          return self.native.execute(self.name, values, after);
        });
      } else if (this.values) {
        if (!Array.isArray(this.values)) {
          const err = new Error("Query values must be an array");
          return after(err);
        }
        const vals = this.values.map(utils.prepareValue);
        client.native.query(this.text, vals, after);
      } else if (this.queryMode === "extended") {
        client.native.query(this.text, [], after);
      } else {
        client.native.query(this.text, after);
      }
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/client.js
var require_client2 = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/client.js"(exports2, module2) {
    var nodeUtils = require("util");
    var Native;
    try {
      Native = require("pg-native");
    } catch (e) {
      throw e;
    }
    var TypeOverrides2 = require_type_overrides();
    var EventEmitter = require("events").EventEmitter;
    var util2 = require("util");
    var ConnectionParameters = require_connection_parameters();
    var NativeQuery = require_query2();
    var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(
      () => {
      },
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead."
    );
    var Client2 = module2.exports = function(config) {
      EventEmitter.call(this);
      config = config || {};
      this._Promise = config.Promise || global.Promise;
      this._types = new TypeOverrides2(config.types);
      this.native = new Native({
        types: this._types
      });
      this._queryQueue = [];
      this._ending = false;
      this._connecting = false;
      this._connected = false;
      this._queryable = true;
      const cp = this.connectionParameters = new ConnectionParameters(config);
      if (config.nativeConnectionString) cp.nativeConnectionString = config.nativeConnectionString;
      this.user = cp.user;
      Object.defineProperty(this, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: cp.password
      });
      this.database = cp.database;
      this.host = cp.host;
      this.port = cp.port;
      this.namedQueries = {};
    };
    Client2.Query = NativeQuery;
    util2.inherits(Client2, EventEmitter);
    Client2.prototype._errorAllQueries = function(err) {
      const enqueueError = (query) => {
        process.nextTick(() => {
          query.native = this.native;
          query.handleError(err);
        });
      };
      if (this._hasActiveQuery()) {
        enqueueError(this._activeQuery);
        this._activeQuery = null;
      }
      this._queryQueue.forEach(enqueueError);
      this._queryQueue.length = 0;
    };
    Client2.prototype._connect = function(cb) {
      const self = this;
      if (this._connecting) {
        process.nextTick(() => cb(new Error("Client has already been connected. You cannot reuse a client.")));
        return;
      }
      this._connecting = true;
      this.connectionParameters.getLibpqConnectionString(function(err, conString) {
        if (self.connectionParameters.nativeConnectionString) conString = self.connectionParameters.nativeConnectionString;
        if (err) return cb(err);
        self.native.connect(conString, function(err2) {
          if (err2) {
            self.native.end();
            return cb(err2);
          }
          self._connected = true;
          self.native.on("error", function(err3) {
            self._queryable = false;
            self._errorAllQueries(err3);
            self.emit("error", err3);
          });
          self.native.on("notification", function(msg) {
            self.emit("notification", {
              channel: msg.relname,
              payload: msg.extra
            });
          });
          self.emit("connect");
          self._pulseQueryQueue(true);
          cb(null, this);
        });
      });
    };
    Client2.prototype.connect = function(callback) {
      if (callback) {
        this._connect(callback);
        return;
      }
      return new this._Promise((resolve2, reject3) => {
        this._connect((error) => {
          if (error) {
            reject3(error);
          } else {
            resolve2(this);
          }
        });
      });
    };
    Client2.prototype.query = function(config, values, callback) {
      let query;
      let result;
      let readTimeout;
      let readTimeoutTimer;
      let queryCallback;
      if (config === null || config === void 0) {
        throw new TypeError("Client was passed a null or undefined query");
      } else if (typeof config.submit === "function") {
        readTimeout = config.query_timeout || this.connectionParameters.query_timeout;
        result = query = config;
        if (typeof values === "function") {
          config.callback = values;
        }
      } else {
        readTimeout = config.query_timeout || this.connectionParameters.query_timeout;
        query = new NativeQuery(config, values, callback);
        if (!query.callback) {
          let resolveOut, rejectOut;
          result = new this._Promise((resolve2, reject3) => {
            resolveOut = resolve2;
            rejectOut = reject3;
          }).catch((err) => {
            Error.captureStackTrace(err);
            throw err;
          });
          query.callback = (err, res) => err ? rejectOut(err) : resolveOut(res);
        }
      }
      if (readTimeout) {
        queryCallback = query.callback || (() => {
        });
        readTimeoutTimer = setTimeout(() => {
          const error = new Error("Query read timeout");
          process.nextTick(() => {
            query.handleError(error, this.connection);
          });
          queryCallback(error);
          query.callback = () => {
          };
          const index = this._queryQueue.indexOf(query);
          if (index > -1) {
            this._queryQueue.splice(index, 1);
          }
          this._pulseQueryQueue();
        }, readTimeout);
        query.callback = (err, res) => {
          clearTimeout(readTimeoutTimer);
          queryCallback(err, res);
        };
      }
      if (!this._queryable) {
        query.native = this.native;
        process.nextTick(() => {
          query.handleError(new Error("Client has encountered a connection error and is not queryable"));
        });
        return result;
      }
      if (this._ending) {
        query.native = this.native;
        process.nextTick(() => {
          query.handleError(new Error("Client was closed and is not queryable"));
        });
        return result;
      }
      if (this._queryQueue.length > 0) {
        queryQueueLengthDeprecationNotice();
      }
      this._queryQueue.push(query);
      this._pulseQueryQueue();
      return result;
    };
    Client2.prototype.end = function(cb) {
      const self = this;
      this._ending = true;
      if (this._connecting && !this._connected) {
        this.once("connect", () => {
          this.end(() => {
          });
        });
      }
      let result;
      if (!cb) {
        result = new this._Promise(function(resolve2, reject3) {
          cb = (err) => err ? reject3(err) : resolve2();
        });
      }
      this.native.end(function() {
        self._connected = false;
        self._errorAllQueries(new Error("Connection terminated"));
        process.nextTick(() => {
          self.emit("end");
          if (cb) cb();
        });
      });
      return result;
    };
    Client2.prototype._hasActiveQuery = function() {
      return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
    };
    Client2.prototype._pulseQueryQueue = function(initialConnection) {
      if (!this._connected) {
        return;
      }
      if (this._hasActiveQuery()) {
        return;
      }
      const query = this._queryQueue.shift();
      if (!query) {
        if (!initialConnection) {
          this.emit("drain");
        }
        return;
      }
      this._activeQuery = query;
      query.submit(this);
      const self = this;
      query.once("_done", function() {
        self._pulseQueryQueue();
      });
    };
    Client2.prototype.cancel = function(query) {
      if (this._activeQuery === query) {
        this.native.cancel(function() {
        });
      } else if (this._queryQueue.indexOf(query) !== -1) {
        this._queryQueue.splice(this._queryQueue.indexOf(query), 1);
      }
    };
    Client2.prototype.ref = function() {
    };
    Client2.prototype.unref = function() {
    };
    Client2.prototype.setTypeParser = function(oid, format, parseFn) {
      return this._types.setTypeParser(oid, format, parseFn);
    };
    Client2.prototype.getTypeParser = function(oid, format) {
      return this._types.getTypeParser(oid, format);
    };
    Client2.prototype.isConnected = function() {
      return this._connected;
    };
    Client2.prototype.getTransactionStatus = function() {
      return this.native.getTransactionStatus();
    };
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/index.js
var require_native = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/native/index.js"(exports2, module2) {
    "use strict";
    module2.exports = require_client2();
  }
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js
var require_lib2 = __commonJS({
  "../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js"(exports2, module2) {
    "use strict";
    var Client2 = require_client();
    var defaults3 = require_defaults();
    var Connection2 = require_connection();
    var Result2 = require_result();
    var utils = require_utils();
    var Pool2 = require_pg_pool();
    var TypeOverrides2 = require_type_overrides();
    var { DatabaseError: DatabaseError2 } = require_dist();
    var { escapeIdentifier: escapeIdentifier2, escapeLiteral: escapeLiteral2 } = require_utils();
    var poolFactory = (Client3) => {
      return class BoundPool extends Pool2 {
        constructor(options) {
          super(options, Client3);
        }
      };
    };
    var PG = function(clientConstructor2) {
      this.defaults = defaults3;
      this.Client = clientConstructor2;
      this.Query = this.Client.Query;
      this.Pool = poolFactory(this.Client);
      this._pools = [];
      this.Connection = Connection2;
      this.types = require_pg_types();
      this.DatabaseError = DatabaseError2;
      this.TypeOverrides = TypeOverrides2;
      this.escapeIdentifier = escapeIdentifier2;
      this.escapeLiteral = escapeLiteral2;
      this.Result = Result2;
      this.utils = utils;
    };
    var clientConstructor = Client2;
    var forceNative = false;
    try {
      forceNative = !!process.env.NODE_PG_FORCE_NATIVE;
    } catch {
    }
    if (forceNative) {
      clientConstructor = require_native();
    }
    module2.exports = new PG(clientConstructor);
    Object.defineProperty(module2.exports, "native", {
      configurable: true,
      enumerable: false,
      get() {
        let native = null;
        try {
          native = new PG(require_native());
        } catch (err) {
          if (err.code !== "MODULE_NOT_FOUND") {
            throw err;
          }
        }
        Object.defineProperty(module2.exports, "native", {
          value: native
        });
        return native;
      }
    });
  }
});

// packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts
var cn_candidate_compose_source_cli_exports = {};
__export(cn_candidate_compose_source_cli_exports, {
  candidateComposeMain: () => candidateComposeMain
});
module.exports = __toCommonJS(cn_candidate_compose_source_cli_exports);

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object2) => {
    const keys = [];
    for (const key in object2) {
      if (Object.prototype.hasOwnProperty.call(object2, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json2 = JSON.stringify(obj, null, 2);
  return json2.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path2, errorMaps, issueData } = params;
  const fullPath = [...path2, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path2, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path2;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema3, params) => {
  return new ZodArray({
    type: schema3,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema3) {
  if (schema3 instanceof ZodObject) {
    const newShape = {};
    for (const key in schema3.shape) {
      const fieldSchema = schema3.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema3._def,
      shape: () => newShape
    });
  } else if (schema3 instanceof ZodArray) {
    return new ZodArray({
      ...schema3._def,
      type: deepPartialify(schema3.element)
    });
  } else if (schema3 instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema3.unwrap()));
  } else if (schema3 instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema3.unwrap()));
  } else if (schema3 instanceof ZodTuple) {
    return ZodTuple.create(schema3.items.map((item) => deepPartialify(item)));
  } else {
    return schema3;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema3) {
    return this.augment({ [key]: schema3 });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types2, params) => {
  return new ZodUnion({
    options: types2,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema3 = this._def.items[itemIndex] || this._def.rest;
      if (!schema3)
        return null;
      return schema3._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema3, params) => {
  return new ZodPromise({
    type: schema3,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema3, effect, params) => {
  return new ZodEffects({
    schema: schema3,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema3, params) => {
  return new ZodEffects({
    schema: schema3,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;

// packages/cloud-deploy/src/config.ts
var RDS_TLS_EXCEPTION_KIND = "aliyun-postgresql-serverless-no-tls";
var text = external_exports.string().min(1).max(512).regex(/^(?!.*REPLACE_WITH_)[^\s\u0000-\u001f]+$/);
var identifier = text.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
var region = text.regex(/^[a-z]{2}-[a-z]+-\d+$|^[a-z]{2}-[a-z]+$/);
var secretRef = text.regex(/^(env:[A-Z][A-Z0-9_]*|file:\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*)$/);
var absoluteDirectory = text.regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/);
var ipv4Cidr = external_exports.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/).refine((value) => {
  const [address, prefix] = value.split("/");
  return address.split(".").every((octet) => Number(octet) <= 255) && Number(prefix) <= 32 && value !== "0.0.0.0/0";
});
var ipv4 = external_exports.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/).refine((value) => value.split(".").every((octet) => Number(octet) <= 255));
var origin = text.regex(/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?\/?$/).url();
var modelUrl = text.regex(/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[a-zA-Z0-9._~-]+)*\/?$/).url();
var email = external_exports.string().max(254).email();
var hostname = external_exports.string().min(1).max(253).regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/);
var githubRepositoryPart = external_exports.string().min(1).max(100).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/);
var websocketUrl = text.regex(/^wss:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[a-zA-Z0-9._~-]+)*\/?$/).url();
var commonEnvironment = {
  regionId: region,
  ecsInstanceId: text.regex(/^i-[a-zA-Z0-9]+$/),
  runtimeRole: identifier,
  ossBucket: text.regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  ossEndpoint: text.regex(/^https:\/\/oss-[a-z0-9-]+(?:-internal)?\.aliyuncs\.com$/),
  ossPrefix: text.regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/),
  publicUrl: origin,
  tlsSecretRef: secretRef
};
var starter = external_exports.object({
  ...commonEnvironment,
  profile: external_exports.literal("starter"),
  dataVolumePath: absoluteDirectory,
  backupTargetRef: secretRef
}).strict();
var production = external_exports.object({
  ...commonEnvironment,
  profile: external_exports.literal("production"),
  preflightTargetIp: ipv4.optional(),
  rdsInstanceId: text.regex(/^pgm-[a-zA-Z0-9]+$/),
  redisInstanceId: text.regex(/^r-[a-zA-Z0-9]+$/),
  databaseSecretRef: secretRef,
  migrationSecretRef: secretRef,
  redisSecretRef: secretRef,
  backupRetentionDays: external_exports.number().int().min(1).max(3650),
  rdsTlsException: external_exports.object({
    kind: external_exports.literal(RDS_TLS_EXCEPTION_KIND),
    allowedCidrs: external_exports.array(ipv4Cidr).min(1).max(32)
  }).strict().optional()
}).strict();
var deploymentInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  environment: external_exports.discriminatedUnion("profile", [starter, production]),
  provision: external_exports.object({
    release: text.regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
    adminEmail: email,
    platformSuperuserEmails: external_exports.array(email).min(1).max(32).optional(),
    modelProfile: external_exports.object({
      baseUrl: modelUrl,
      modelId: identifier,
      apiKeySecretRef: secretRef
    }).strict(),
    asrProfile: external_exports.object({
      recordingTurnSilenceMs: external_exports.number().int().min(200).max(2e3).optional(),
      provider: identifier,
      baseUrl: websocketUrl,
      modelId: identifier,
      apiKeySecretRef: secretRef
    }).strict().optional(),
    githubIssueProfile: external_exports.object({
      tokenSecretRef: secretRef,
      repoOwner: githubRepositoryPart,
      repoName: githubRepositoryPart,
      attachmentsBranch: identifier
    }).strict().optional(),
    // Cloudflare Email Sending for verification, password-reset, feedback and test emails.
    // Omitted = the API starts but every send is refused as MAIL_NOT_CONFIGURED.
    mailProfile: external_exports.object({
      cloudflareAccountId: identifier,
      apiTokenSecretRef: secretRef,
      mailFrom: email,
      // The domain onboarded in Cloudflare Email Sending; mailFrom must be on it.
      sendingDomain: hostname
    }).strict().optional()
  }).strict()
}).strict();
var deploymentConfigSchema = deploymentInputSchema.superRefine((config, ctx) => {
  const env = config.environment;
  const endpoints = [
    `https://oss-${env.regionId}.aliyuncs.com`,
    `https://oss-${env.regionId}-internal.aliyuncs.com`
  ];
  if (!endpoints.includes(env.ossEndpoint)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["environment", "ossEndpoint"], message: "REGION_MISMATCH" });
  }
  if (env.profile === "production" && env.databaseSecretRef === env.migrationSecretRef) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["environment", "migrationSecretRef"], message: "SEPARATE_ROLES_REQUIRED" });
  }
  const mail = config.provision.mailProfile;
  if (mail && mail.mailFrom.slice(mail.mailFrom.lastIndexOf("@") + 1).toLowerCase() !== mail.sendingDomain) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["provision", "mailProfile", "mailFrom"], message: "MAIL_FROM_NOT_ON_SENDING_DOMAIN" });
  }
  const superusers = config.provision.platformSuperuserEmails;
  if (superusers && new Set(superusers.map((value) => value.trim().toLowerCase())).size !== superusers.length) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["provision", "platformSuperuserEmails"], message: "DUPLICATE_PLATFORM_SUPERUSER" });
  }
});

// packages/cloud-deploy/src/storage-config.ts
var ossSchema = external_exports.object({
  region: external_exports.string().regex(/^[a-z]{2}-[a-z]+(?:-\d+)?$/),
  bucket: external_exports.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  endpoint: external_exports.string().url(),
  prefix: external_exports.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/),
  authMode: external_exports.enum(["ecs-role", "environment"]),
  roleName: external_exports.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional()
}).superRefine((v, ctx) => {
  if (![`https://oss-${v.region}.aliyuncs.com`, `https://oss-${v.region}-internal.aliyuncs.com`].includes(v.endpoint)) {
    ctx.addIssue({ code: "custom", path: ["endpoint"], message: "region mismatch" });
  }
  if (v.authMode === "ecs-role" && !v.roleName) ctx.addIssue({ code: "custom", path: ["roleName"], message: "required" });
});
function objectStoreConfig(env = process.env) {
  const profile = env.WORKSPACEX_DEPLOY_PROFILE;
  if (profile !== void 0 && profile !== "starter" && profile !== "production") throw new Error("Invalid WORKSPACEX_DEPLOY_PROFILE");
  const backend = env.WORKSPACEX_OBJECT_STORE ?? (profile ? "oss" : "fs");
  if (backend !== "oss" && backend !== "fs") throw new Error("Invalid WORKSPACEX_OBJECT_STORE");
  if (profile && backend !== "oss") throw new Error("Cloud deployments require OSS");
  if (backend === "fs") {
    if ([env.OSS_BUCKET, env.OSS_REGION, env.OSS_ENDPOINT, env.OSS_PREFIX].some((v) => v !== void 0)) {
      throw new Error("OSS configuration requires WORKSPACEX_OBJECT_STORE=oss");
    }
    return { backend, root: env.WORKSPACEX_OBJECT_ROOT || void 0 };
  }
  const result = ossSchema.safeParse({
    region: env.OSS_REGION,
    bucket: env.OSS_BUCKET,
    endpoint: env.OSS_ENDPOINT,
    prefix: env.OSS_PREFIX,
    authMode: env.OSS_AUTH_MODE ?? "ecs-role",
    roleName: env.OSS_ROLE_NAME
  });
  if (!result.success) throw new Error(`Invalid OSS configuration: ${[...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  return { backend, oss: result.data };
}
function deploymentStorageEnvironment(config) {
  const value = config.environment;
  const env = {
    WORKSPACEX_DEPLOY_PROFILE: value.profile,
    WORKSPACEX_OBJECT_STORE: "oss",
    OSS_REGION: value.regionId,
    OSS_BUCKET: value.ossBucket,
    OSS_ENDPOINT: value.ossEndpoint,
    OSS_PREFIX: value.ossPrefix,
    OSS_AUTH_MODE: "ecs-role",
    OSS_ROLE_NAME: value.runtimeRole
  };
  objectStoreConfig(env);
  return env;
}

// packages/cloud-deploy/src/image-reference.ts
function canonicalDockerReference(reference2) {
  const at = reference2.indexOf("@");
  const name = at < 0 ? reference2 : reference2.slice(0, at);
  const digest3 = at < 0 ? "" : reference2.slice(at);
  const slash = name.indexOf("/");
  if (slash < 0) return `docker.io/library/${name}${digest3}`;
  const first = name.slice(0, slash);
  if (first === "docker.io" || first === "index.docker.io") {
    const path2 = name.slice(slash + 1);
    return `docker.io/${path2.includes("/") ? path2 : `library/${path2}`}${digest3}`;
  }
  if (first.includes(".") || first.includes(":") || first === "localhost") return reference2;
  return `docker.io/${reference2}`;
}

// packages/cloud-deploy/src/release.ts
var digestImage = external_exports.string().max(512).regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/);
var artifact = external_exports.object({ image: digestImage }).strict();
var releaseManifestSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  release: external_exports.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  platform: external_exports.enum(["linux/amd64", "linux/arm64"]),
  images: external_exports.object({ web: artifact, api: artifact, agent: artifact, sandbox: artifact, postgres: artifact, redis: artifact }).strict()
}).strict();
function validateReleaseManifest(input) {
  const result = releaseManifestSchema.safeParse(input);
  if (!result.success) throw new Error(`INVALID_RELEASE_MANIFEST: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`);
  return result.data;
}
function requiredReleaseImages(manifest, profile) {
  const services = ["web", "api", "agent", "sandbox"];
  if (profile === "starter") services.push("postgres", "redis");
  return services.map((service) => ({ service, image: manifest.images[service].image }));
}
async function verifyPrewarmedRelease(manifestInput, profile, execute2) {
  const manifest = validateReleaseManifest(manifestInput);
  const checked = [];
  for (const { service, image } of requiredReleaseImages(manifest, profile)) {
    let raw;
    try {
      raw = JSON.parse(await execute2(["docker", "image", "inspect", image]));
    } catch {
      throw new Error(`RELEASE_IMAGE_UNAVAILABLE: ${service}`);
    }
    const inspection = external_exports.array(external_exports.object({
      Os: external_exports.string(),
      Architecture: external_exports.string(),
      RepoDigests: external_exports.array(external_exports.string()),
      Config: external_exports.object({ Labels: external_exports.record(external_exports.string()).nullable().optional() })
    })).length(1).safeParse(raw);
    if (!inspection.success) throw new Error(`INVALID_IMAGE_INSPECTION: ${service}`);
    const actual2 = inspection.data[0];
    if (!actual2.RepoDigests.map(canonicalDockerReference).includes(canonicalDockerReference(image))) throw new Error(`IMAGE_DIGEST_MISMATCH: ${service}`);
    if (`${actual2.Os}/${actual2.Architecture}` !== manifest.platform) throw new Error(`IMAGE_PLATFORM_MISMATCH: ${service}`);
    if (!["postgres", "redis"].includes(service) && actual2.Config.Labels?.["org.opencontainers.image.revision"] !== manifest.sourceRevision) {
      throw new Error(`IMAGE_REVISION_MISMATCH: ${service}`);
    }
    checked.push(service);
  }
  return { release: manifest.release, sourceRevision: manifest.sourceRevision, checked, cloudVerified: false };
}

// packages/cloud-deploy/src/compose.ts
var optionsSchema = external_exports.object({
  projectName: external_exports.string().regex(/^[a-z][a-z0-9_-]{0,40}$/),
  runtimeDirectory: external_exports.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/)
}).strict();
function createCloudCompose(configInput, releaseInput, optionsInput) {
  const config = deploymentConfigSchema.parse(configInput);
  const release = validateReleaseManifest(releaseInput);
  const options = optionsSchema.parse(optionsInput);
  if (config.provision.release !== release.release) throw new Error("RELEASE_VERSION_MISMATCH");
  const dir = options.runtimeDirectory;
  const logging = { driver: "local", options: { "max-size": "10m", "max-file": "5" } };
  const base = { logging, pull_policy: "never", restart: "unless-stopped", init: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], pids_limit: 256 };
  const bind = (source2, target, readOnly = false) => ({ type: "bind", source: source2, target, read_only: readOnly, bind: { create_host_path: false } });
  const services = {
    web: { ...base, image: release.images.web.image, platform: release.platform, env_file: [{ path: `${dir}/web.env`, format: "raw" }], ports: ["127.0.0.1:3000:3000"], mem_limit: "2g", cpus: 2 },
    api: {
      ...base,
      image: release.images.api.image,
      platform: release.platform,
      env_file: [{ path: `${dir}/api.env`, format: "raw" }],
      ports: ["127.0.0.1:3200:3200"],
      mem_limit: "2g",
      cpus: 2,
      environment: { ...deploymentStorageEnvironment(config), PORT: "3200", KERNEL_DEEP_AGENT_BASE_URL: "http://agent:8000", KERNEL_SKILL_SANDBOX_SOCKET: "/run/sandbox/skill-sandbox.sock", NATIVE_SESSION_SOCKET: "/run/sessions/skill-sandbox.sock" },
      volumes: [bind(`${dir}/sandbox`, "/run/sandbox"), bind(`${dir}/sessions`, "/run/sessions"), bind(`${dir}/certs`, "/run/certs", true)]
    },
    agent: {
      ...base,
      user: "1000:1000",
      image: release.images.agent.image,
      platform: release.platform,
      env_file: [{ path: `${dir}/agent.env`, format: "raw" }],
      expose: ["8000"],
      mem_limit: "4g",
      cpus: 2,
      volumes: [bind(`${dir}/sessions`, "/run/sessions"), bind(`${dir}/agent-certs`, "/run/agent-certs", true)]
    },
    sandbox: {
      ...base,
      image: release.images.sandbox.image,
      platform: release.platform,
      network_mode: "none",
      read_only: true,
      user: "1000:1000",
      mem_limit: "1g",
      memswap_limit: "1g",
      cpus: 1,
      pids_limit: 128,
      tmpfs: ["/tmp:rw,noexec,nosuid,size=256m,mode=1777"],
      environment: { SKILL_SANDBOX_SOCKET: "/run/sandbox/skill-sandbox.sock" },
      volumes: [bind(`${dir}/sandbox`, "/run/sandbox")]
    },
    "sandbox-sessions": {
      ...base,
      image: release.images.sandbox.image,
      platform: release.platform,
      network_mode: "none",
      read_only: true,
      user: "1000:1000",
      mem_limit: "1g",
      memswap_limit: "1g",
      cpus: 1,
      pids_limit: 128,
      security_opt: ["no-new-privileges:true", `seccomp=${dir}/docker-seccomp.json`, "apparmor=workspacex-native-sessions"],
      tmpfs: ["/tmp:rw,noexec,nosuid,size=256m,mode=1777"],
      environment: { SKILL_SANDBOX_SESSIONS_ONLY: "1", SKILL_SANDBOX_SOCKET: "/run/sessions/skill-sandbox.sock" },
      volumes: [bind(`${dir}/sessions`, "/run/sessions"), bind(`${dir}/agent-certs`, "/run/agent-certs", true)]
    }
  };
  if (config.environment.profile === "starter") {
    const data = config.environment.dataVolumePath;
    services.postgres = { logging, image: release.images.postgres.image, platform: release.platform, pull_policy: "never", restart: "unless-stopped", env_file: [{ path: `${dir}/postgres.env`, format: "raw" }], volumes: [bind(`${data}/postgres`, "/var/lib/postgresql/data")], mem_limit: "2g", cpus: 2, pids_limit: 256 };
    services.redis = { logging, image: release.images.redis.image, platform: release.platform, pull_policy: "never", restart: "unless-stopped", command: ["redis-server", "/run/secrets/redis.conf"], volumes: [bind(`${data}/redis`, "/data"), bind(`${dir}/redis.conf`, "/run/secrets/redis.conf", true)], mem_limit: "512m", cpus: 1, pids_limit: 128 };
  }
  return { name: options.projectName, services };
}

// packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts
var import_node_crypto4 = require("node:crypto");

// packages/cloud-deploy/src/cn-maintenance-host/fixed_transport.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
function pinnedPythonBootstrap(moduleMap, writerFence = false) {
  const bundle = pinnedPythonModuleFinder(moduleMap);
  return "import sys,runpy,importlib.util,importlib.machinery; " + (writerFence ? "s=importlib.util.spec_from_loader('writer_fence',importlib.machinery.SourceFileLoader('writer_fence','/proc/self/fd/11')); m=importlib.util.module_from_spec(s);sys.modules['writer_fence']=m;s.loader.exec_module(m); " : "") + bundle + "\nsys.argv=['/proc/self/fd/10']+sys.argv[1:];runpy.run_path('/proc/self/fd/10',run_name='__main__')";
}
function pinnedPythonModuleFinder(moduleMap) {
  return Object.keys(moduleMap).length === 0 ? "" : `
import importlib.abc
class PinnedFinder(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  pinned=${JSON.stringify(moduleMap)}
  if fullname in pinned:return importlib.util.spec_from_loader(fullname,importlib.machinery.SourceFileLoader(fullname,pinned[fullname]))
sys.meta_path.insert(0,PinnedFinder())
`;
}
var fail = (code) => {
  throw new Error(code);
};
function protectedPrivateBytes(path2, expectedSha256) {
  if (!path2.startsWith("/") || path2.split("/").includes("..")) fail("PRIVATE_PATH_INVALID");
  const parts = path2.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const st = (0, import_node_fs.lstatSync)("/" + parts.slice(0, i).join("/"));
    if (!st.isDirectory() || st.uid !== 0 || st.gid !== 0 || st.mode & 18) fail("PRIVATE_PARENT_UNTRUSTED");
  }
  const before = (0, import_node_fs.lstatSync)(path2), fd = (0, import_node_fs.openSync)(path2, import_node_fs.constants.O_RDONLY | import_node_fs.constants.O_NOFOLLOW);
  try {
    const st = (0, import_node_fs.fstatSync)(fd);
    if (!st.isFile() || st.uid !== 0 || st.gid !== 0 || st.nlink !== 1 || (st.mode & 511) !== 384 || st.dev !== before.dev || st.ino !== before.ino || st.size > 1048576) fail("PRIVATE_FILE_UNTRUSTED");
    const bytes = (0, import_node_fs.readFileSync)(fd), after = (0, import_node_fs.fstatSync)(fd);
    if (expectedSha256 !== void 0 && (!/^[a-f0-9]{64}$/.test(expectedSha256) || (0, import_node_crypto.createHash)("sha256").update(bytes).digest("hex") !== expectedSha256)) fail("PRIVATE_FILE_HASH_MISMATCH");
    if (st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) fail("PRIVATE_FILE_CHANGED");
    return bytes;
  } finally {
    (0, import_node_fs.closeSync)(fd);
  }
}
function protectedPrivateJson(path2, expectedSha256) {
  const bytes = protectedPrivateBytes(path2, expectedSha256);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("PRIVATE_JSON_INVALID");
  }
}
function protectedExecutable(command3) {
  if (!command3.path.startsWith("/") || command3.path.includes("..") || !/^[a-f0-9]{64}$/.test(command3.sha256)) fail("COMMAND_BINDING_INVALID");
  const parts = command3.path.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const st = (0, import_node_fs.lstatSync)("/" + parts.slice(0, i).join("/"));
    if (!st.isDirectory() || st.uid !== 0 || st.gid !== 0 || st.mode & 18) fail("COMMAND_PARENT_UNTRUSTED");
  }
  const before = (0, import_node_fs.lstatSync)(command3.path);
  if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1 || (before.mode & 511) !== 448) fail("COMMAND_METADATA_UNTRUSTED");
  const fd = (0, import_node_fs.openSync)(command3.path, import_node_fs.constants.O_RDONLY | import_node_fs.constants.O_NOFOLLOW);
  try {
    const after = (0, import_node_fs.fstatSync)(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("COMMAND_CHANGED");
    if ((0, import_node_crypto.createHash)("sha256").update((0, import_node_fs.readFileSync)(fd)).digest("hex") !== command3.sha256) fail("COMMAND_HASH_MISMATCH");
    return fd;
  } catch (error) {
    (0, import_node_fs.closeSync)(fd);
    throw error;
  }
}
async function runFixed(command3, args, input, interpreter) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("ROOT_LINUX_REQUIRED");
  try {
    (0, import_node_fs.fstatSync)(9);
  } catch {
    fail("INHERITED_FD9_REQUIRED");
  }
  const fd = protectedExecutable(command3);
  let dependency;
  const modules = [];
  try {
    const moduleMap = {};
    if (command3.pythonModules) {
      if (interpreter !== "python" || command3.writerFenceModule || command3.path !== "/usr/local/lib/workspacex-cn/current_epoch_qualification.py") fail("PYTHON_BUNDLE_ENTRY_FORBIDDEN");
      const allowed = { epoch_recovery: "cn-maintenance-recovery-evidence-verifier", writer_fence: "writer_fence", cn_backup_package: "cn_backup_package", cn_backup_sql: "cn_backup_sql", cn_production_recovery_executor: "cn_production_recovery_executor", current_held_epoch_evidence_producer: "current_held_epoch_evidence_producer", isolated_canonical_plan_factory: "isolated_canonical_plan_factory", isolated_conservation_evidence_producer: "isolated_conservation_evidence_producer", isolated_conservation_inputs: "isolated_conservation_inputs", isolated_conservation_plan: "isolated_conservation_plan", isolated_conservation_stage: "isolated_conservation_stage", isolated_rehearsal: "isolated_rehearsal" };
      if (Object.keys(command3.pythonModules).sort().join(",") !== Object.keys(allowed).sort().join(",")) fail("PYTHON_BUNDLE_CLOSURE");
      for (const name of Object.keys(allowed).sort()) {
        const module2 = command3.pythonModules[name];
        if (module2.path !== `/usr/local/lib/workspacex-cn/${allowed[name]}.py`) fail("PYTHON_BUNDLE_PATH");
        moduleMap[name] = `/proc/self/fd/${12 + modules.length}`;
        modules.push(protectedExecutable(module2));
      }
    }
    if (command3.writerFenceModule) dependency = protectedExecutable(command3.writerFenceModule);
    return await new Promise((resolve2, reject3) => {
      const bootstrap = pinnedPythonBootstrap(moduleMap, dependency !== void 0);
      const child = (0, import_node_child_process.spawn)(interpreter === "python" ? "/usr/bin/python3" : "/usr/bin/bash", interpreter === "python" ? ["-I", "-c", bootstrap, ...args] : ["/proc/self/fd/10", ...args], {
        shell: false,
        detached: true,
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", PYTHONNOUSERSITE: "1" },
        stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", 9, fd, dependency === void 0 ? "ignore" : dependency, ...modules]
      });
      let stdout = "", size = 0;
      const killGroup = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
          }
        }
      };
      const timer = setTimeout(killGroup, 3e5);
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1048576) killGroup();
        else stdout += chunk;
      });
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timer);
        reject3(new Error("FIXED_COMMAND_SPAWN_FAILED"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 && size <= 1048576 ? resolve2({ stdout }) : reject3(new Error("FIXED_COMMAND_FAILED"));
      });
      child.stdin.end(input === void 0 ? "" : JSON.stringify(input) + "\n");
    });
  } finally {
    for (const module2 of modules) (0, import_node_fs.closeSync)(module2);
    if (dependency !== void 0) (0, import_node_fs.closeSync)(dependency);
    (0, import_node_fs.closeSync)(fd);
  }
}
var runFixedPython = (command3, args, input) => runFixed(command3, args, input, "python");
var runFixedBash = (command3, args, input) => runFixed(command3, args, input, "bash");
async function inheritedFd9Lock() {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("ROOT_LINUX_REQUIRED");
  const parent = (0, import_node_fs.lstatSync)("/var/lib/workspacex-cn/runtime");
  if (!parent.isDirectory() || parent.uid !== 0 || parent.gid !== 0 || (parent.mode & 511) !== 448) fail("LOCK_PARENT_UNTRUSTED");
  const actual2 = (0, import_node_fs.lstatSync)("/var/lib/workspacex-cn/runtime/release.lock");
  const inherited = (0, import_node_fs.fstatSync)(9);
  if (!actual2.isFile() || actual2.uid !== 0 || actual2.gid !== 0 || actual2.nlink !== 1 || (actual2.mode & 511) !== 384 || actual2.dev !== inherited.dev || actual2.ino !== inherited.ino) fail("CANONICAL_FD9_REQUIRED");
  const fdinfo = (0, import_node_fs.readFileSync)("/proc/self/fdinfo/9", "utf8");
  if (!/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+/m.test(fdinfo)) fail("CANONICAL_FD9_LOCK_NOT_HELD");
  let released = false;
  return async () => {
    if (released) fail("CANONICAL_FD9_ALREADY_RELEASED");
    released = true;
    (0, import_node_fs.closeSync)(9);
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/sealed_runtime.ts
var import_node_crypto3 = require("node:crypto");
var import_node_child_process3 = require("node:child_process");
var import_node_fs2 = require("node:fs");

// ../wsx-cn-maintenance-a1cb-20261006/node_modules/.pnpm/pg@8.22.0/node_modules/pg/esm/index.mjs
var import_lib = __toESM(require_lib2(), 1);
var Client = import_lib.default.Client;
var Pool = import_lib.default.Pool;
var Connection = import_lib.default.Connection;
var types = import_lib.default.types;
var Query = import_lib.default.Query;
var DatabaseError = import_lib.default.DatabaseError;
var escapeIdentifier = import_lib.default.escapeIdentifier;
var escapeLiteral = import_lib.default.escapeLiteral;
var Result = import_lib.default.Result;
var TypeOverrides = import_lib.default.TypeOverrides;
var defaults = import_lib.default.defaults;

// packages/cloud-deploy/src/cn-migration-source-identity.ts
var import_node_crypto2 = require("node:crypto");
var import_node_net = require("node:net");
var hash = external_exports.string().regex(/^[a-f0-9]{64}$/);
var id = external_exports.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
var port = external_exports.number().int().min(1).max(65535);
var migrationSourceSchema = external_exports.object({
  accountId: id,
  regionId: id,
  dbInstanceId: id,
  database: id,
  user: id,
  endpointSha256: hash,
  serverAddressSha256: hash.nullable(),
  port: port.nullable(),
  identityLane: external_exports.enum(["sql-server-address", "aliyun-private-endpoint"]),
  clientPeerAddressSha256: hash,
  clientPeerPort: port,
  configurationSha256: hash,
  providerEvidenceSha256: hash,
  sslMode: external_exports.enum(["disable", "verify-full"]),
  clientEncrypted: external_exports.boolean(),
  clientTlsAuthorized: external_exports.boolean()
}).strict();
var requestId = external_exports.string().min(1);
var exception = deploymentInputSchema.shape.environment.options[1].shape.rdsTlsException.unwrap();
var sourceEvidenceSchema = external_exports.object({
  request: external_exports.object({ regionId: id, dbInstanceId: id }).strict(),
  configuration: external_exports.object({
    sha256: hash,
    endpointSha256: hash,
    regionId: id,
    rdsInstanceId: id,
    host: external_exports.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),
    port,
    database: id,
    user: id,
    sslMode: external_exports.enum(["disable", "verify-full"]),
    rdsTlsException: exception.optional()
  }).strict(),
  stsResponse: external_exports.object({ RequestId: requestId, AccountId: id }).passthrough(),
  attributeResponse: external_exports.object({ RequestId: requestId, Items: external_exports.object({ DBInstanceAttribute: external_exports.array(external_exports.object({
    DBInstanceId: id,
    RegionId: id,
    Engine: external_exports.literal("PostgreSQL"),
    InstanceNetworkType: external_exports.literal("VPC"),
    DBInstanceNetType: external_exports.literal("Intranet"),
    DBInstanceStatus: external_exports.literal("Running"),
    ConnectionString: external_exports.string().min(1),
    Port: external_exports.string().regex(/^[0-9]+$/),
    VpcId: id
  }).passthrough()).length(1) }).passthrough() }).passthrough(),
  netInfoResponse: external_exports.object({ RequestId: requestId, InstanceNetworkType: external_exports.literal("VPC"), DBInstanceNetInfos: external_exports.object({ DBInstanceNetInfo: external_exports.array(external_exports.object({
    IPType: external_exports.string(),
    VPCId: id,
    Port: external_exports.string().regex(/^[0-9]+$/),
    ConnectionString: external_exports.string(),
    IPAddress: external_exports.string()
  }).passthrough()).min(1).max(32) }).passthrough() }).passthrough()
}).strict();
var identityHash = (v) => (0, import_node_crypto2.createHash)("sha256").update(v).digest("hex");
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => [k, canonical(value)]));
  return v;
}
var providerIdentityDigest = (e) => identityHash(JSON.stringify(canonical({ request: e.request, stsResponse: e.stsResponse, attributeResponse: e.attributeResponse, netInfoResponse: e.netInfoResponse })));
function ipv42(s) {
  if ((0, import_node_net.isIP)(s) !== 4) return;
  return s.split(".").reduce((n, v) => n * 256 + Number(v) >>> 0, 0);
}
function inCidr(ip, cidr) {
  const [address, bits, ...extra] = cidr.split("/");
  const n = address === void 0 ? void 0 : ipv42(address), value = ipv42(ip), length = Number(bits);
  if (extra.length || n === void 0 || value === void 0 || !/^\d+$/.test(bits ?? "") || length < 1 || length > 32) return false;
  const mask = 4294967295 << 32 - length >>> 0;
  return (n & mask) === (value & mask);
}
function privateAddress(ip) {
  return ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((c) => inCidr(ip, c));
}
function verifyExternalSourceIdentity(source2, e) {
  const c = e.configuration, a = e.attributeResponse.Items.DBInstanceAttribute[0];
  if (c.regionId !== e.request.regionId || c.rdsInstanceId !== e.request.dbInstanceId || source2.accountId !== e.stsResponse.AccountId || source2.regionId !== e.request.regionId || source2.dbInstanceId !== e.request.dbInstanceId || a.DBInstanceId !== source2.dbInstanceId || a.RegionId !== source2.regionId || a.ConnectionString !== c.host || Number(a.Port) !== c.port || source2.database !== c.database || source2.user !== c.user || source2.configurationSha256 !== c.sha256 || source2.sslMode !== c.sslMode || source2.endpointSha256 !== c.endpointSha256 || source2.endpointSha256 !== identityHash(`${c.host}:${c.port}`) || source2.providerEvidenceSha256 !== providerIdentityDigest(e)) return false;
  const endpoints = e.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo.filter((n2) => n2.IPType === "Private" && n2.ConnectionString === c.host && Number(n2.Port) === c.port && n2.VPCId === a.VpcId);
  if (endpoints.length !== 1) return false;
  const n = endpoints[0];
  if (!privateAddress(n.IPAddress) || source2.clientPeerAddressSha256 !== identityHash(n.IPAddress) || source2.clientPeerPort !== c.port) return false;
  if (c.sslMode === "disable") {
    if (source2.clientEncrypted || source2.clientTlsAuthorized || !c.rdsTlsException || !c.rdsTlsException.allowedCidrs.length) return false;
  } else if (!source2.clientEncrypted || !source2.clientTlsAuthorized) return false;
  if (source2.identityLane === "aliyun-private-endpoint") return source2.serverAddressSha256 === null && source2.port === null;
  return source2.serverAddressSha256 !== null && source2.port !== null;
}

// packages/cloud-deploy/src/cn-maintenance-host/pinned-app-9b/migration-pg.ts
var exceptionSchema = deploymentInputSchema.shape.environment.options[1].shape.rdsTlsException.unwrap();
function ipv4Number(address) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return;
  const parts = address.split(".").map(Number);
  if (parts.some((p) => p > 255)) return;
  return parts.reduce((n, p) => n * 256 + p >>> 0, 0);
}
function approveExistingNoTls(source2, sourceEvidence, approved, localAddress) {
  const evidence = sourceEvidenceSchema.parse(sourceEvidence);
  const exception2 = exceptionSchema.parse(approved);
  if (source2.sslMode !== "disable" || !verifyExternalSourceIdentity(source2, evidence) || JSON.stringify(exception2) !== JSON.stringify(evidence.configuration.rdsTlsException)) throw new Error("MIGRATION_NO_TLS_EXCEPTION_UNAPPROVED");
  if (localAddress !== void 0) {
    const address = ipv4Number(localAddress.replace(/^::ffff:/, ""));
    const permitted = address !== void 0 && exception2.allowedCidrs.some((cidr) => {
      const [base, bits] = cidr.split("/");
      const prefix = ipv4Number(base);
      const length = Number(bits);
      if (length < 1 || length > 32) return false;
      const mask = 4294967295 << 32 - length >>> 0;
      return prefix !== void 0 && (address & mask) === (prefix & mask);
    });
    if (!permitted) throw new Error("MIGRATION_NO_TLS_SOURCE_CIDR_MISMATCH");
  }
}
function verifyMigrationPeer(expected, observed, options) {
  if (observed.database !== expected.database || observed.user !== expected.user || identityHash(observed.remoteAddress) !== expected.clientPeerAddressSha256 || observed.remotePort !== expected.clientPeerPort || expected.identityLane === "sql-server-address" && (observed.serverAddress === null || identityHash(observed.serverAddress) !== expected.serverAddressSha256 || observed.serverPort !== expected.port)) throw new Error("MIGRATION_LIVE_DATABASE_PEER_MISMATCH");
  if (expected.sslMode === "verify-full") {
    if (!observed.encrypted || !observed.authorized || !expected.clientEncrypted || !expected.clientTlsAuthorized) throw new Error("MIGRATION_LIVE_DATABASE_PEER_MISMATCH");
  } else {
    if (observed.encrypted || observed.authorized || expected.clientEncrypted || expected.clientTlsAuthorized || !observed.localAddress) throw new Error("MIGRATION_NO_TLS_EXCEPTION_UNAPPROVED");
    approveExistingNoTls(expected, options?.sourceEvidence, options?.approvedRdsTlsException, observed.localAddress);
  }
}

// packages/cloud-deploy/src/managed-data-preflight.ts
var import_node_child_process2 = require("node:child_process");
var import_node_util = require("node:util");
var Expected = external_exports.object({
  region: external_exports.string().regex(/^(?:[a-z]{2}(?:-[a-z]+)+-\d+|cn-[a-z]+)$/),
  rdsInstanceId: external_exports.string().regex(/^pgm-[a-zA-Z0-9]+$/),
  redisInstanceId: external_exports.string().regex(/^r-[a-zA-Z0-9]+$/),
  backupRetentionDays: external_exports.number().int().min(1).max(3650),
  postgresHost: external_exports.string().min(1),
  redisHost: external_exports.string().min(1),
  rdsTlsException: external_exports.object({
    kind: external_exports.literal("aliyun-postgresql-serverless-no-tls"),
    allowedCidrs: external_exports.array(external_exports.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/).refine((value) => {
      const [address, prefix] = value.split("/");
      return address.split(".").every((octet) => Number(octet) <= 255) && Number(prefix) <= 32 && value !== "0.0.0.0/0";
    })).min(1).max(32)
  }).strict().optional()
});
var RdsTransportExpected = Expected.pick({ region: true, rdsInstanceId: true, postgresHost: true, rdsTlsException: true }).strict();
var execute = (0, import_node_util.promisify)(import_node_child_process2.execFile);
var record = external_exports.record(external_exports.unknown());
function one(raw, container) {
  const outer = record.safeParse(raw);
  if (!outer.success) return;
  const inner = record.safeParse(outer.data[container]);
  if (!inner.success || !Array.isArray(inner.data.DBInstanceAttribute) || inner.data.DBInstanceAttribute.length !== 1) return;
  const entry = record.safeParse(inner.data.DBInstanceAttribute[0]);
  return entry.success ? entry.data : void 0;
}
function rdsReason(raw, expected) {
  const rds = one(raw, "Items");
  if (!rds) return "rds_response_unrecognized";
  if (rds.DBInstanceId !== expected.rdsInstanceId || rds.RegionId !== expected.region) return "rds_resource_mismatch";
  if (rds.ConnectionString !== expected.postgresHost) return "rds_endpoint_mismatch";
  if (rds.DBInstanceStatus !== "Running" || rds.DBInstanceType !== "Primary") return "rds_not_ready_primary";
  if (rds.Engine !== "PostgreSQL" || !/^16(?:\.\d+)*$/.test(String(rds.EngineVersion))) return "rds_engine_not_supported";
  if (rds.InstanceNetworkType !== "VPC" || rds.LockMode !== "Unlock") return "rds_private_access_not_ready";
  if (expected.rdsTlsException) {
    if (rds.Category !== "serverless_standard") return "rds_serverless_ha_not_proven";
    if (!String(rds.DBInstanceClass).toLowerCase().includes("serverless")) return "rds_tls_exception_not_serverless";
  } else if (rds.Category !== "HighAvailability") return "rds_ha_not_proven";
  return "verified";
}
function rdsTlsReason(raw, expected) {
  const result = record.safeParse(raw);
  if (!result.success) return "rds_tls_response_unrecognized";
  if (expected.rdsTlsException) {
    if (result.data.SSLEnabled !== "off") return "rds_tls_exception_state_mismatch";
    return "serverless_tls_exception_verified";
  }
  if (result.data.SSLEnabled !== "on") return "rds_tls_not_enabled";
  if (result.data.ConnectionString !== expected.postgresHost) return "rds_tls_endpoint_mismatch";
  return "verified";
}
function rdsNetworkReason(raw, expected) {
  if (!expected.rdsTlsException) return "verified";
  const outer = record.safeParse(raw), expectedCidrs = [...new Set(expected.rdsTlsException.allowedCidrs)].sort();
  if (!outer.success) return "rds_whitelist_response_unrecognized";
  const container = record.safeParse(outer.data.Items);
  if (!container.success) return "rds_whitelist_response_unrecognized";
  const items = container.data.DBInstanceIPArray;
  if (!Array.isArray(items) || items.length < 1) return "rds_whitelist_response_unrecognized";
  const actual2 = /* @__PURE__ */ new Set();
  for (const item of items) {
    const parsed = record.safeParse(item);
    if (!parsed.success || parsed.data.WhitelistNetworkType !== "MIX" || typeof parsed.data.SecurityIPList !== "string") return "rds_network_constraint_unproven";
    const cidrs = parsed.data.SecurityIPList.split(",").map((value) => value.trim()).filter(Boolean).map((value) => value.includes("/") ? value : `${value}/32`);
    if (cidrs.includes("0.0.0.0/0")) return "rds_whitelist_mismatch";
    if (parsed.data.DBInstanceIPArrayAttribute !== "hidden") for (const cidr of cidrs) actual2.add(cidr);
  }
  if (JSON.stringify([...actual2].sort()) !== JSON.stringify(expectedCidrs)) return "rds_whitelist_mismatch";
  return "serverless_tls_exception_network_verified";
}
function verifyRdsTransportPreflight(input, evidence) {
  const expected = RdsTransportExpected.parse(input);
  return [
    { id: "rds", reason: rdsReason(evidence.attribute, expected) },
    { id: "rds-tls", reason: rdsTlsReason(evidence.ssl, expected) },
    { id: "rds-network", reason: rdsNetworkReason(evidence.allowlist, expected) }
  ].map((check) => ({ ...check, passed: ["verified", "serverless_tls_exception_verified", "serverless_tls_exception_network_verified"].includes(check.reason) }));
}

// packages/cloud-deploy/src/cn-maintenance-host/migration_library.ts
function approveExistingMaintenanceTransportInputs(input) {
  const source2 = migrationSourceSchema.parse(input.source), evidence = sourceEvidenceSchema.parse(input.sourceEvidence);
  if (!verifyExternalSourceIdentity(source2, evidence)) throw Error("MAINTENANCE_EXTERNAL_TRANSPORT_IDENTITY");
  if (source2.sslMode === "disable") {
    const checks = verifyRdsTransportPreflight({ region: source2.regionId, rdsInstanceId: source2.dbInstanceId, postgresHost: evidence.configuration.host, rdsTlsException: evidence.configuration.rdsTlsException }, { attribute: evidence.attributeResponse, ssl: input.sslResponse, allowlist: input.allowlistResponse });
    if (checks.some((c) => !c.passed)) throw Error("MAINTENANCE_EXISTING_EXCEPTION_PROVIDER_UNPROVEN");
    approveExistingNoTls(source2, evidence, input.approvedRdsTlsException);
  }
  const endpoint = evidence.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo.find((e) => e.IPType === "Private" && e.VPCId === evidence.attributeResponse.Items.DBInstanceAttribute[0].VpcId && e.ConnectionString === evidence.configuration.host && Number(e.Port) === evidence.configuration.port);
  return { privateAddress: endpoint.IPAddress };
}
function verifyExistingMaintenanceTransport(input, observed) {
  approveExistingMaintenanceTransportInputs(input);
  const source2 = migrationSourceSchema.parse(input.source), evidence = sourceEvidenceSchema.parse(input.sourceEvidence);
  verifyMigrationPeer(source2, observed, { sourceEvidence: evidence, approvedRdsTlsException: input.approvedRdsTlsException });
  return { sslMode: source2.sslMode, configurationSha256: source2.configurationSha256, providerEvidenceSha256: source2.providerEvidenceSha256 };
}

// packages/cloud-deploy/src/cn-maintenance-host/a_route.ts
var aRouteOperationNames = ["acquireReleaseLock", "prepareOffline", "verifyPreholdRecoveryCapability", "verifyIsolatedCandidateAcceptance", "persistMaintenanceHold", "verifyMaintenanceHoldPresent", "blockAllWrites", "verifyWritesBlocked", "captureAndVerifyCurrentEpochRecovery", "verifyCurrentEpochIsolatedCandidateAcceptance", "migrateExactPlan", "verifyHeldCandidateReadback", "stageCandidateRuntime", "verifyCandidateRuntimeIdentity", "persistCandidateResumeIntent", "resumeExactCandidateWriters", "verifyCandidateWritersResumed", "verifyPublicAcceptance", "observeOpenedCandidate", "blockCandidateWriters", "verifyNoMigrationCommitted", "resumeUnchangedBaselineCancellation", "verifyBaselineCancellation", "clearAndVerifyMaintenanceHold", "recordRecoveryRequired", "recordReconciliationRequired"];
async function runARouteMaintenanceRelease(request, ops) {
  if (request.maintenanceOptIn !== "stop-all-writes-and-require-database-recovery" || !/^[a-f0-9]{40}$/.test(request.sourceRevision) || !/^[a-f0-9]{40}$/.test(request.baselineRevision) || !/^[a-f0-9]{64}$/.test(request.migrationPlanSha256) || !/^[A-Za-z0-9-]{1,128}$/.test(request.attemptId)) throw Error("A_ROUTE_IDENTITY_INVALID");
  for (const name of aRouteOperationNames) if (typeof ops[name] !== "function") throw Error("A_ROUTE_CAPABILITY_MISSING:" + name);
  const identity2 = Object.freeze({ sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId });
  const release = await ops.acquireReleaseLock(identity2);
  let holdIntent = false, migrationIntent = false, resumeIntent = false, retainLock = false, holdCleared = false;
  try {
    await ops.prepareOffline(identity2);
    await ops.verifyPreholdRecoveryCapability(identity2);
    await ops.verifyIsolatedCandidateAcceptance(identity2);
    holdIntent = true;
    await ops.persistMaintenanceHold(identity2);
    await ops.verifyMaintenanceHoldPresent(identity2);
    await ops.blockAllWrites(identity2);
    await ops.verifyWritesBlocked(identity2);
    await ops.captureAndVerifyCurrentEpochRecovery(identity2);
    await ops.verifyCurrentEpochIsolatedCandidateAcceptance(identity2);
    migrationIntent = true;
    await ops.migrateExactPlan(identity2);
    await ops.verifyHeldCandidateReadback(identity2);
    await ops.stageCandidateRuntime(identity2);
    await ops.verifyCandidateRuntimeIdentity(identity2);
    resumeIntent = true;
    await ops.persistCandidateResumeIntent(identity2);
    await ops.resumeExactCandidateWriters(identity2);
    await ops.verifyCandidateWritersResumed(identity2);
    await ops.verifyPublicAcceptance(identity2);
    await ops.clearAndVerifyMaintenanceHold(identity2);
    holdCleared = true;
    await ops.observeOpenedCandidate(identity2);
    holdIntent = false;
  } catch (error) {
    if (!holdIntent) throw error;
    retainLock = true;
    try {
      let recoveryUnknown = false;
      try {
        if (holdCleared) await ops.persistMaintenanceHold(identity2);
        await ops.verifyMaintenanceHoldPresent(identity2);
      } catch {
        recoveryUnknown = true;
      }
      try {
        if (resumeIntent) await ops.blockCandidateWriters(identity2);
        await ops.verifyWritesBlocked(identity2);
      } catch {
        recoveryUnknown = true;
      }
      if (recoveryUnknown) throw Error("A_ROUTE_RECOVERY_STATE_UNKNOWN");
    } catch {
      try {
        await ops.recordReconciliationRequired(identity2);
      } catch {
      }
      throw new MaintenanceWriteStateUnknown();
    }
    if (!migrationIntent) {
      try {
        await ops.verifyNoMigrationCommitted(identity2);
        await ops.resumeUnchangedBaselineCancellation(identity2);
        await ops.verifyBaselineCancellation(identity2);
        await ops.clearAndVerifyMaintenanceHold(identity2);
        holdIntent = false;
        retainLock = false;
      } catch {
        try {
          await ops.recordReconciliationRequired(identity2);
        } catch {
        }
        throw new MaintenanceWriteStateUnknown();
      }
      throw error;
    }
    try {
      await ops.recordRecoveryRequired(identity2);
    } catch {
    }
    throw new MaintenanceRecoveryRequired();
  } finally {
    if (!retainLock) await release();
  }
}

// packages/cloud-deploy/src/cn-maintenance-release.ts
var MaintenanceRecoveryRequired = class extends Error {
  constructor() {
    super("MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD");
  }
};
var MaintenanceWriteStateUnknown = class extends Error {
  constructor() {
    super("MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED");
  }
};
async function runMaintenanceRelease(request, ops) {
  if (ops.aRoute) return runARouteMaintenanceRelease(request, ops.aRoute);
  if (request.maintenanceOptIn !== "stop-all-writes-and-require-database-recovery") throw new Error("MAINTENANCE_OPT_IN_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(request.sourceRevision) || !/^[a-f0-9]{40}$/.test(request.baselineRevision) || !/^[a-f0-9]{64}$/.test(request.migrationPlanSha256) || !/^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId)) throw new Error("MAINTENANCE_IDENTITY_INVALID");
  const required = ["verifyThreeDatabaseRecovery", "persistMaintenanceHold", "verifyMaintenanceHoldPresent", "verifyMaintenanceHoldCleared", "blockAllWrites", "verifyAllWritersDrained", "migrateExactPlan", "verifyProductionDynamic", "verifyPreactivate", "activate", "verifyAcceptance", "resumeWrites", "verifyWritesResumed", "clearMaintenanceHold", "verifyWritesBlocked", "recordWriteStateReconciliationRequired", "recordDatabaseRecoveryRequired"];
  for (const name of required) if (typeof ops[name] !== "function") throw new Error(`MAINTENANCE_CAPABILITY_MISSING:${name}`);
  const identity2 = Object.freeze({ sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId });
  const releaseLock = await ops.acquireReleaseLock(identity2);
  let holdAttempted = false;
  let retainLock = false;
  try {
    await ops.prepareOffline(identity2);
    await ops.verifyThreeDatabaseRecovery(identity2);
    holdAttempted = true;
    await ops.persistMaintenanceHold(identity2);
    await ops.verifyMaintenanceHoldPresent(identity2);
    await ops.blockAllWrites(identity2);
    await ops.verifyAllWritersDrained(identity2);
    await ops.migrateExactPlan(identity2);
    await ops.verifyProductionDynamic(identity2);
    await ops.verifyPreactivate(identity2);
    await ops.activate(identity2);
    await ops.verifyAcceptance(identity2);
    await ops.resumeWrites(identity2);
    await ops.verifyWritesResumed(identity2);
    await ops.clearMaintenanceHold(identity2);
    await ops.verifyMaintenanceHoldCleared(identity2);
    holdAttempted = false;
  } catch (error) {
    if (holdAttempted) {
      try {
        await ops.verifyMaintenanceHoldPresent(identity2);
        await ops.verifyWritesBlocked(identity2);
      } catch {
        retainLock = true;
        try {
          await ops.recordWriteStateReconciliationRequired(identity2);
        } catch {
        }
        throw new MaintenanceWriteStateUnknown();
      }
      try {
        await ops.recordDatabaseRecoveryRequired(identity2);
      } catch {
      }
      throw new MaintenanceRecoveryRequired();
    }
    throw error;
  } finally {
    try {
      if (!retainLock) await releaseLock();
    } catch {
      if (holdAttempted) throw new MaintenanceRecoveryRequired();
      throw new Error("MAINTENANCE_RELEASE_LOCK_CLEANUP_FAILED");
    }
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/controller.ts
var writerCallbacks = ["blockAllWrites", "verifyAllWritersDrained", "verifyWritesBlocked", "resumeWrites", "verifyWritesResumed", "recordWriteStateReconciliationRequired", "recordDatabaseRecoveryRequired"];
function requireValue(ok, code) {
  if (!ok) throw new Error(code);
}
function sameIdentity(a, b) {
  if (!a || typeof a !== "object") return false;
  const value = a;
  return Object.keys(value).sort().join(",") === Object.keys(b).sort().join(",") && Object.entries(b).every(([key, v]) => value[key] === v);
}
function parseOne(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("COMMAND_RESPONSE_INVALID");
  }
}
function holdRecord(value, identity2, state) {
  requireValue(value && value.schemaVersion === 1 && value.state === state && sameIdentity(value.identity, identity2) && /^[a-f0-9]{32}$/.test(value.generation) && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isSafeInteger(value.device) && Number.isSafeInteger(value.inode), "HOLD_READBACK_INVALID");
}
async function runHostMaintenance(request, binding2, primitives, run) {
  requireValue(request.maintenanceOptIn === "stop-all-writes-and-require-database-recovery", "MAINTENANCE_OPT_IN_REQUIRED");
  requireValue(/^[a-f0-9]{40}$/.test(request.sourceRevision) && /^[a-f0-9]{40}$/.test(request.baselineRevision) && /^[a-f0-9]{64}$/.test(request.migrationPlanSha256) && /^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId), "MAINTENANCE_IDENTITY_INVALID");
  requireValue(sameIdentity(binding2.identity, { sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId }), "HOST_IDENTITY_MISMATCH");
  requireValue(binding2.writerPlanPath.startsWith("/") && /^[a-f0-9]{64}$/.test(binding2.writerPlanSha256) && /^[a-f0-9]{64}$/.test(binding2.writerPlanCanonicalSha256), "WRITER_PLAN_BINDING_INVALID");
  await primitives.assertTrustedBinding(binding2);
  if (primitives.aRoute) {
    await runARouteMaintenanceRelease(request, primitives.aRoute);
    return;
  }
  await primitives.verifyRecoveryExecutorCapability(binding2.identity);
  let originalHold;
  let clearedHold;
  const hold = async (action, input) => parseOne((await run(binding2.hold, [action, "/var/lib/workspacex-cn/runtime"], input)).stdout);
  const ops = {
    acquireReleaseLock: primitives.acquireReleaseLock.bind(primitives),
    prepareOffline: primitives.prepareOffline.bind(primitives),
    verifyThreeDatabaseRecovery: primitives.verifyThreeDatabaseRecovery.bind(primitives),
    migrateExactPlan: primitives.migrateExactPlan.bind(primitives),
    verifyProductionDynamic: primitives.verifyProductionDynamic.bind(primitives),
    verifyPreactivate: primitives.verifyPreactivate.bind(primitives),
    activate: primitives.activate.bind(primitives),
    verifyAcceptance: primitives.verifyAcceptance.bind(primitives),
    persistMaintenanceHold: async (identity2) => {
      const value = await hold("create", identity2);
      holdRecord(value, identity2, "held");
      originalHold = value;
    },
    verifyMaintenanceHoldPresent: async (identity2) => {
      const value = await hold("read");
      holdRecord(value, identity2, "held");
      if (originalHold) requireValue(JSON.stringify(value) === JSON.stringify(originalHold), "HOLD_GENERATION_CHANGED");
      else originalHold = value;
    },
    clearMaintenanceHold: async (identity2) => {
      requireValue(originalHold, "HOLD_CAS_INPUT_MISSING");
      const value = await hold("clear", originalHold);
      holdRecord(value, identity2, "cleared");
      clearedHold = value;
    },
    verifyMaintenanceHoldCleared: async (identity2) => {
      const value = await hold("read");
      holdRecord(value, identity2, "cleared");
      requireValue(clearedHold && JSON.stringify(value) === JSON.stringify(clearedHold), "HOLD_CLEAR_READBACK_CHANGED");
    }
  };
  for (const callback of writerCallbacks) ops[callback] = async (identity2) => {
    const value = parseOne((await run(binding2.writerFence, ["--apply-reviewed-fence", binding2.writerPlanPath, binding2.writerPlanSha256, callback])).stdout);
    if (callback === "verifyAllWritersDrained" || callback === "verifyWritesBlocked") {
      requireValue(value && value.schemaVersion === 1 && value.kind === "maintenance-writers-held" && value.ready === false && sameIdentity(value.identity, identity2) && originalHold && value.holdGeneration === originalHold.generation && value.holdSha256 === originalHold.sha256 && value.planSha256 === binding2.writerPlanCanonicalSha256 && typeof value.observedAt === "number" && Number.isFinite(value.observedAt) && Date.now() / 1e3 - value.observedAt >= 0 && Date.now() / 1e3 - value.observedAt <= 30 && value.host && typeof value.host.instanceId === "string" && typeof value.host.bootId === "string" && value.databasePeers && Object.keys(value.databasePeers).sort().join(",") === "workspacex,workspacex_agent,workspacex_memory" && ["holdSha256", "planSha256", "observationSha256", "databaseSessionsSha256"].every((key) => /^[a-f0-9]{64}$/.test(value[key])) && Array.isArray(value.families) && value.families.join(",") === "http,socket,queue,background,agent,checkpoint,memory,privileged", "WRITER_GUARD_RESPONSE_INVALID");
    } else {
      requireValue(value && value.callback === callback && sameIdentity(value.identity, identity2) && value.ready === false && value.productionAvailabilityProven === false && typeof value.state === "string", "WRITER_RESPONSE_INVALID");
    }
    requireValue(sameIdentity(identity2, binding2.identity), "WRITER_IDENTITY_CHANGED");
  };
  await runMaintenanceRelease(request, ops);
}
async function runHostMaintenanceRetainingFd9(request, binding2, primitives, run) {
  try {
    await runHostMaintenance(request, binding2, primitives, run);
  } catch (error) {
    if (!(error instanceof MaintenanceWriteStateUnknown) && !(error instanceof MaintenanceRecoveryRequired)) throw error;
    process.stderr.write(error instanceof MaintenanceRecoveryRequired ? "MAINTENANCE_DATABASE_RECOVERY_REQUIRED_LOCK_RETAINED\n" : "MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED\n");
    await new Promise(() => {
      setInterval(() => {
      }, 6e4);
    });
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/sealed_runtime.ts
var maintenanceSourceActions = ["capture-current-epoch-draft", "stage-epoch-external-evidence", "finalize-epoch-input", "qualify-current-epoch", "verify-qualified-current-epoch", "held-candidate-readback", "stage-candidate-and-seal", "canonical-candidate-acceptance", "browser-candidate-acceptance", "read-public-candidate-identity", "observe-opened-candidate"];
var candidateSafetyActions = ["block", "rebind-held-epoch-for-reblock", "verify-blocked"];
var candidateSafetyRequest = (message) => message.operation === "candidate-operation" && candidateSafetyActions.includes(message.action) || message.operation === "callback" && message.callback === "recordWriteStateReconciliationRequired";
var databases = ["workspacex", "workspacex_agent", "workspacex_memory"];
function requireProof(ok, code) {
  if (!ok) throw new Error(code);
}
var asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
function canonical2(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical2).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => asciiJson(k) + ":" + canonical2(value[k])).join(",") + "}";
  return asciiJson(value);
}
var runtimeDigest = (value) => (0, import_node_crypto3.createHash)("sha256").update(canonical2(value)).digest("hex");
var equal = (a, b) => canonical2(a) === canonical2(b);
function verifySealedSessionTransport(session, authority, identity2, toolRevision) {
  if (authority === void 0) {
    requireProof(session.tls?.ssl === true, "SEALED_RUNTIME_SESSION_TLS");
    return;
  }
  const now = Date.now() / 1e3;
  requireProof(authority.schemaVersion === 1 && authority.kind === "existing-production-maintenance-transport" && equal(authority.identity, identity2) && authority.toolRevision === toolRevision && authority.source?.sslMode === "disable" && authority.configurationPath === `/etc/workspacex-cn/maintenance-host/${identity2.sourceRevision}/${identity2.attemptId}/approved-baseline-deployment.json` && authority.configurationSha256 === authority.source.configurationSha256 && Number.isFinite(authority.notBefore) && Number.isFinite(authority.expiresAt) && authority.expiresAt - authority.notBefore <= 3600 && authority.notBefore <= now && now < authority.expiresAt, "SEALED_RUNTIME_TRANSPORT_AUTHORITY");
  requireProof(session.tls?.ssl === false && session.socket?.localAddress === "192.168.100.40", "SEALED_RUNTIME_SESSION_TRANSPORT");
  const proof = verifyExistingMaintenanceTransport(authority, { database: session.peer.database, user: session.role, serverAddress: session.peer.serverAddr, serverPort: session.peer.serverPort, ...session.socket });
  requireProof(equal(session.transport, proof), "SEALED_RUNTIME_TRANSPORT_PROOF");
}
function parseProtectedRuntimePlan(value, expected) {
  requireProof(/^[a-f0-9]{40}$/.test(expected.toolRevision) && expected.sourcePlan.runtimeSessionBootstrapAuthorized === true && expected.sourcePlan.productionActionsAuthorized === true && expected.sourcePlanPath.startsWith("/etc/workspacex-cn/") && !expected.sourcePlanPath.split("/").includes("..") && /^[a-f0-9]{64}$/.test(expected.sourcePlanSha256), "SEALED_RUNTIME_EXPECTED_BINDING");
  requireProof(value && typeof value === "object", "SEALED_RUNTIME_SCHEMA");
  const v = value;
  requireProof(Object.keys(v).sort().join(",") === ["schemaVersion", "kind", "identity", "toolRevision", "sourcePlanPath", "sourcePlanSha256", "sourcePlanCanonicalSha256", "runtimePlanSha256", "runtimePlan", "sessionsSha256", "processIdentity", "ready", "productionAvailabilityProven"].sort().join(","), "SEALED_RUNTIME_SCHEMA");
  requireProof(v.schemaVersion === 1 && v.kind === "sealed-maintenance-writer-runtime" && v.ready === false && v.productionAvailabilityProven === false, "SEALED_RUNTIME_SCHEMA");
  requireProof(equal(v.identity, expected.identity) && v.toolRevision === expected.toolRevision && v.sourcePlanPath === expected.sourcePlanPath && v.sourcePlanSha256 === expected.sourcePlanSha256, "SEALED_RUNTIME_SOURCE_BINDING");
  requireProof(v.sourcePlanCanonicalSha256 === runtimeDigest(expected.sourcePlan) && v.runtimePlanSha256 === runtimeDigest(v.runtimePlan), "SEALED_RUNTIME_DIGEST");
  const p = v.runtimePlan;
  requireProof(p && equal(p.identity, expected.identity) && p.toolRevision === expected.toolRevision && p.runtimeSourcePlanSha256 === v.sourcePlanCanonicalSha256, "SEALED_RUNTIME_PLAN_IDENTITY");
  const source2 = { ...p };
  for (const key of ["runtimeSourcePlanSha256", "controlSessions", "diagnosticSessions", "diagnosticClientAddress", "runtimeHelperProcesses"]) delete source2[key];
  if (expected.sourcePlan.holdGenerationPolicy === "bind-held-at-runtime") {
    requireProof(/^[a-f0-9]{32}$/.test(p.holdGeneration), "SEALED_RUNTIME_HOLD_GENERATION");
    delete source2.holdGeneration;
  }
  const base = { ...expected.sourcePlan };
  for (const key of ["runtimeSourcePlanSha256", "controlSessions", "diagnosticSessions", "diagnosticClientAddress", "runtimeHelperProcesses"]) delete base[key];
  if (expected.sourcePlan.holdGenerationPolicy === "bind-held-at-runtime") delete base.holdGeneration;
  requireProof(equal(source2, base), "SEALED_RUNTIME_UNAPPROVED_CHANGE");
  for (const mode of ["control", "diagnostic"]) {
    const sessions = p[mode + "Sessions"];
    requireProof(sessions && Object.keys(sessions).sort().join(",") === [...databases].sort().join(","), "SEALED_RUNTIME_DATABASE_SET");
    for (const db of databases) {
      const session = sessions[db];
      requireProof(session && equal(session.peer, expected.sourcePlan.databasePeers[db]) && Number.isSafeInteger(session.pid) && session.pid > 1 && typeof session.backendStart === "string" && session.backendStart.length > 0 && typeof session.clientAddr === "string", "SEALED_RUNTIME_SESSION_IDENTITY");
      verifySealedSessionTransport(session, expected.sourcePlan.connectionTransportAuthorizations?.[db]?.[mode], expected.identity, expected.toolRevision);
      requireProof(mode === "diagnostic" ? session.role === expected.sourcePlan.diagnosticRole : expected.sourcePlan.databaseWriterRoles[db].includes(session.role), "SEALED_RUNTIME_SESSION_ROLE");
      if (mode === "diagnostic") requireProof(session.clientAddr === p.diagnosticClientAddress, "SEALED_RUNTIME_DIAGNOSTIC_ADDRESS");
    }
  }
  requireProof(v.sessionsSha256 === runtimeDigest({ control: p.controlSessions, diagnostic: p.diagnosticSessions }), "SEALED_RUNTIME_SESSION_DIGEST");
  const process2 = v.processIdentity;
  requireProof(process2?.kind === "process" && process2.uid === 0 && Number.isSafeInteger(process2.pid) && process2.pid > 1 && Number.isSafeInteger(process2.startTicks) && process2.startTicks > 0 && typeof process2.exe === "string" && process2.exe.startsWith("/") && /^[a-f0-9]{64}$/.test(process2.exeSha256), "SEALED_RUNTIME_PROCESS_IDENTITY");
  const helpers = p.runtimeHelperProcesses;
  requireProof(Array.isArray(helpers) && helpers.length === 6 && new Set(helpers.map((h) => h.pid)).size === 6, "SEALED_RUNTIME_HELPER_SET");
  for (const helper of helpers) requireProof(helper.uid === 0 && helper.parentPid === process2.pid && helper.exe === expected.sourcePlan.controlRuntime.nodePath && helper.exeSha256 === expected.sourcePlan.controlRuntime.nodeSha256 && Number.isSafeInteger(helper.pid) && helper.pid > 1 && Number.isSafeInteger(helper.startTicks) && helper.startTicks > 0, "SEALED_RUNTIME_HELPER_IDENTITY");
  return v;
}
function readProtectedRuntimePlan(path2, sha2563, expected) {
  requireProof(path2 === `/var/lib/workspacex-cn/runtime/${expected.identity.attemptId}/sealed-writer-runtime.json` && /^[a-f0-9]{64}$/.test(sha2563), "SEALED_RUNTIME_PATH");
  return parseProtectedRuntimePlan(protectedPrivateJson(path2, sha2563), expected);
}
var persistentSourceModules = Object.freeze(Object.fromEntries(["acceptance_receipt_store", "candidate_canonical_acceptance", "candidate_browser_acceptance", "candidate_readonly_docker", "candidate_stage_actions", "candidate_stage_host", "candidate_plan_producer", "candidate_pointer_adapter", "candidate_completion_contract", "concretize_candidate_template", "maintenance_source_operations", "parent_source_invocation_receipt", "cn_backup_backend", "cn_backup_channel", "cn_backup_host", "cn_backup_package", "cn_backup_sql", "cn_backup_stream", "cn_backup_watchdog", "cn_maintenance_hold", "cn_production_recovery_executor", "current_epoch_qualification", "current_held_epoch_evidence_producer", "isolated_canonical_plan_factory", "isolated_conservation_evidence_producer", "isolated_conservation_inputs", "isolated_conservation_plan", "isolated_conservation_stage", "isolated_rehearsal", "opened_host_evidence", "opened_service_health", "retained_backend_observer", "retained_backup_host", "retained_epoch_acquisition", "retained_epoch_capture"].map((n) => [n, n + ".py"]).concat([["epoch_recovery", "cn-maintenance-recovery-evidence-verifier.py"], ["compiled_maintenance_activation", "cn-maintenance-activation.py"]])));
function launch(spec) {
  requireProof(process.platform === "linux" && process.getuid?.() === 0, "ROOT_LINUX_REQUIRED");
  (0, import_node_fs2.fstatSync)(9);
  const descriptors = [];
  try {
    descriptors.push(protectedExecutable(spec.host.writerFence));
    for (const name of ["writer_fence", "control_connection", "fixed_probes"]) descriptors.push(protectedExecutable(spec.modules[name]));
    if (spec.candidate) {
      requireProof(Object.keys(spec.candidate.modules).sort().join(",") === "candidate_backend_collector,candidate_host_transport,candidate_writer" && (!spec.candidate.reference || spec.candidate.reference.path === `/etc/workspacex-cn/maintenance-candidate/${spec.identity.sourceRevision}/${spec.identity.attemptId}/candidate-plan.json` && /^[a-f0-9]{64}$/.test(spec.candidate.reference.sha256)), "PERSISTENT_CANDIDATE_SOURCE_CLOSURE");
      for (const name of ["candidate_writer", "candidate_backend_collector", "candidate_host_transport"]) {
        requireProof(spec.candidate.modules[name].path === `/usr/local/lib/workspacex-cn/${name}.py`, "PERSISTENT_CANDIDATE_MODULE_PATH");
        descriptors.push(protectedExecutable(spec.candidate.modules[name]));
      }
    }
    const lazy = {};
    if (spec.sourceOperationModules) {
      requireProof(spec.candidate && Object.keys(spec.sourceOperationModules).sort().join(",") === Object.keys(persistentSourceModules).sort().join(","), "PERSISTENT_OPERATION_MODULE_CLOSURE");
      for (const [name, file] of Object.entries(persistentSourceModules).sort()) {
        const command3 = spec.sourceOperationModules[name];
        requireProof(command3.path === `/usr/local/lib/workspacex-cn/${file}`, "PERSISTENT_OPERATION_MODULE_PATH");
        lazy[name] = `/proc/self/fd/${10 + descriptors.length}`;
        descriptors.push(protectedExecutable(command3));
      }
    }
    const bootstrap = "import sys,importlib.util,importlib.machinery; " + pinnedPythonModuleFinder(lazy) + "\n" + ["writer_fence", "control_connection", "fixed_probes", "host_transport"].map((name, i) => {
      const fd = name === "host_transport" ? 10 : 11 + i;
      return `s=importlib.util.spec_from_loader('${name}',importlib.machinery.SourceFileLoader('${name}','/proc/self/fd/${fd}'));m=importlib.util.module_from_spec(s);sys.modules['${name}']=m;s.loader.exec_module(m);`;
    }).join(" ") + (spec.candidate ? ["candidate_writer", "candidate_backend_collector", "candidate_host_transport"].map((name, i) => `s=importlib.util.spec_from_loader('${name}',importlib.machinery.SourceFileLoader('${name}','/proc/self/fd/${14 + i}'));m=importlib.util.module_from_spec(s);sys.modules['${name}']=m;s.loader.exec_module(m);`).join(" ") : "") + " sys.modules['host_transport'].serve_reviewed_fence(sys.argv[1],sys.argv[2])";
    const child = (0, import_node_child_process3.spawn)("/usr/bin/python3", ["-I", "-c", bootstrap, spec.sourcePlanPath, spec.sourcePlanSha256], { shell: false, detached: false, env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", 9, ...descriptors] });
    let buffer = Buffer.alloc(0), sequence = 0, retained = false, dead = false;
    const expired = /* @__PURE__ */ new Set();
    const pending = /* @__PURE__ */ new Map();
    const rejectAll = () => {
      dead = true;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("PERSISTENT_FENCE_CONNECTION_LOST"));
      }
      pending.clear();
    };
    const receive = (value) => {
      const p = pending.get(value.sequence);
      if (!p) {
        if (expired.delete(value.sequence)) {
          retained = true;
          return;
        }
        rejectAll();
        return;
      }
      pending.delete(value.sequence);
      clearTimeout(p.timer);
      value.ok === true ? p.resolve(value) : p.reject(new Error("PERSISTENT_FENCE_REJECTED"));
    };
    const wait = (n, timeoutMs = 3e5) => new Promise((resolve2, reject3) => {
      const timer = setTimeout(() => {
        pending.delete(n);
        expired.add(n);
        retained = true;
        if (expired.size > 64) rejectAll();
        reject3(new Error("PERSISTENT_FENCE_DEADLINE_UNKNOWN"));
      }, timeoutMs);
      pending.set(n, { resolve: resolve2, reject: reject3, timer });
    });
    const start = wait(0);
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1048576) {
        retained = true;
        rejectAll();
        return;
      }
      let index;
      while ((index = buffer.indexOf(10)) !== -1) {
        const line = buffer.subarray(0, index);
        buffer = buffer.subarray(index + 1);
        try {
          receive(JSON.parse(line.toString("utf8")));
        } catch {
          retained = true;
          rejectAll();
        }
      }
    });
    child.stderr.resume();
    child.on("error", rejectAll);
    child.on("exit", rejectAll);
    return { started: async () => {
      const reply = await start;
      requireProof(reply.processIdentity?.pid === child.pid, "PERSISTENT_SERVER_PID_BINDING");
      return reply;
    }, request: (message) => {
      requireProof(!dead && (!retained || candidateSafetyRequest(message)), "PERSISTENT_FENCE_RETAINED_OR_LOST");
      const n = ++sequence;
      const recoveryTimeout = spec.sourcePlan.recoveryAuthorization?.operationTimeoutMs;
      const response = wait(n, message.operation === "migrate-exact-plan" ? spec.sourcePlan.migrationAuthorization?.operationTimeoutMs : message.operation === "recover-retained-baseline" ? recoveryTimeout * 3 + 6e4 : void 0);
      child.stdin.write(JSON.stringify({ ...message, sequence: n }) + "\n");
      return response;
    }, retain: () => {
      retained = true;
    }, close: async () => {
      requireProof(!retained, "PERSISTENT_FENCE_RETAINED");
      child.stdin.end();
      await new Promise((resolve2, reject3) => {
        if (child.exitCode !== null) return child.exitCode === 0 ? resolve2() : reject3(new Error("PERSISTENT_FENCE_EXIT_FAILED"));
        const timer = setTimeout(() => reject3(new Error("PERSISTENT_FENCE_CLOSE_DEADLINE")), 1e4);
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0 ? resolve2() : reject3(new Error("PERSISTENT_FENCE_EXIT_FAILED"));
        });
      });
    } };
  } finally {
    for (const fd of descriptors) (0, import_node_fs2.closeSync)(fd);
  }
}
function createPersistentWriterLifecycle(spec) {
  let driver, binding2, sealedRecord, unknown = false, accepted = false, migrated = false, candidateReference = spec.candidate?.reference ? Object.freeze({ ...spec.candidate.reference }) : void 0;
  return {
    async start() {
      requireProof(!driver, "PERSISTENT_WRITER_ALREADY_STARTED");
      requireProof(spec.sourcePlanPath === spec.host.writerPlanPath && spec.sourcePlanSha256 === spec.host.writerPlanSha256 && equal(spec.identity, spec.host.identity), "PERSISTENT_WRITER_SOURCE_BINDING");
      driver = (spec.driverFactory ?? launch)(spec);
      try {
        const reply = await driver.started();
        requireProof(reply.kind === "persistent-writer-runtime-started" && equal(reply.identity, spec.identity) && reply.toolRevision === spec.toolRevision, "PERSISTENT_WRITER_START_PROTOCOL");
        const sealed = (spec.readSeal ?? readProtectedRuntimePlan)(reply.sealedPlanPath, reply.sealedPlanSha256, spec);
        requireProof(sealed.runtimePlanSha256 === reply.runtimePlanSha256 && equal(sealed.processIdentity, reply.processIdentity), "PERSISTENT_WRITER_SEAL_BINDING");
        sealedRecord = sealed;
        binding2 = { ...spec.host, writerPlanPath: reply.sealedPlanPath, writerPlanSha256: reply.sealedPlanSha256, writerPlanCanonicalSha256: sealed.runtimePlanSha256 };
        return binding2;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async invoke(callback, identity2) {
      requireProof(driver && binding2 && (!unknown || callback === "recordWriteStateReconciliationRequired") && writerCallbacks.includes(callback) && equal(identity2, spec.identity), "PERSISTENT_WRITER_CALLBACK_BINDING");
      try {
        const response = await driver.request({ operation: "callback", callback, identity: identity2 });
        if (callback === "verifyWritesResumed") {
          requireProof(response.value?.callback === callback && response.value.state === "writes-resumed" && response.value.ready === false && response.value.productionAvailabilityProven === false && equal(response.value.identity, spec.identity), "PERSISTENT_WRITER_ACCEPTED_READBACK");
          accepted = true;
        }
        return { stdout: JSON.stringify(response.value) };
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async baselineCancellation(identity2, action) {
      requireProof(driver && binding2 && !unknown && !migrated && equal(identity2, spec.identity) && sealedRecord && spec.candidate, "PERSISTENT_BASELINE_CANCEL_BINDING");
      try {
        const reply = await driver.request({ operation: "baseline-cancellation-operation", identity: identity2, action }), v = reply.value;
        requireProof(v?.schemaVersion === 1 && v.kind === "baseline-cancellation-operation" && equal(v.identity, identity2) && v.operation === action && v.planSha256 === sealedRecord.runtimePlanSha256 && v.holdState === "held" && v.writesHeld === (action === "verify-no-migration") && v.ready === false && v.productionAvailabilityProven === false && (action === "resume-baseline" || /^[a-f0-9]{64}$/.test(v.observationSha256)), "PERSISTENT_BASELINE_CANCEL_READBACK");
        if (action === "verify-baseline") accepted = true;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async bindCandidateReference(identity2, reference2) {
      requireProof(driver && binding2 && !unknown && migrated && spec.candidate && !candidateReference && equal(identity2, spec.identity) && reference2.path === `/etc/workspacex-cn/maintenance-candidate/${identity2.sourceRevision}/${identity2.attemptId}/candidate-plan.json` && /^[a-f0-9]{64}$/.test(reference2.sha256), "PERSISTENT_CANDIDATE_LATE_BINDING");
      const value = (spec.readCandidatePlan ?? protectedPrivateJson)(reference2.path, reference2.sha256);
      requireProof(value && Object.keys(value).sort().join(",") === "artifact,plan,schemaVersion,toolRevision" && value.artifact && Object.keys(value.artifact).sort().join(",") === "path,sha256" && typeof value.artifact.path === "string" && value.artifact.path.startsWith("/etc/workspacex-cn/") && !value.artifact.path.split("/").includes("..") && /^[a-f0-9]{64}$/.test(value.artifact.sha256) && value.plan?.artifactSha256 === value.artifact.sha256 && value.schemaVersion === 1 && value.toolRevision === spec.toolRevision && equal(value.plan?.identity, identity2) && value.plan?.holdGeneration === sealedRecord?.runtimePlan.holdGeneration && /^[a-f0-9]{64}$/.test(value.plan?.epoch) && /^[a-f0-9]{64}$/.test(value.plan?.migrationCompletionSha256), "PERSISTENT_CANDIDATE_LATE_PLAN");
      candidateReference = Object.freeze({ ...reference2 });
    },
    async sourceOperation(identity2, action, input) {
      requireProof(driver && binding2 && !unknown && spec.sourceOperationModules && equal(identity2, spec.identity) && maintenanceSourceActions.includes(action) && input.path === `/etc/workspacex-cn/maintenance-source-inputs/${identity2.sourceRevision}/${identity2.attemptId}/${action}.json` && /^[a-f0-9]{64}$/.test(input.sha256), "PERSISTENT_SOURCE_OPERATION_BINDING");
      try {
        const reply = await driver.request({ operation: "maintenance-source-operation", identity: identity2, action, input }), v = reply.value;
        requireProof(v?.schemaVersion === 1 && v.kind === "maintenance-source-operation" && equal(v.identity, identity2) && v.toolRevision === spec.toolRevision && v.action === action && equal(v.input, input) && v.ready === false && v.productionAvailabilityProven === false && v.value && typeof v.value === "object", "PERSISTENT_SOURCE_OPERATION_READBACK");
        return v.value;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async candidateOperation(identity2, action) {
      const reference2 = candidateReference;
      requireProof(driver && binding2 && (!unknown || candidateSafetyActions.includes(action)) && spec.candidate && reference2 && equal(identity2, spec.identity) && reference2.path === `/etc/workspacex-cn/maintenance-candidate/${identity2.sourceRevision}/${identity2.attemptId}/candidate-plan.json` && /^[a-f0-9]{64}$/.test(reference2.sha256), "PERSISTENT_CANDIDATE_BINDING");
      try {
        const reply = await driver.request({ operation: "candidate-operation", identity: identity2, candidatePlan: reference2, action }), v = reply.value;
        requireProof(v?.schemaVersion === 1 && v.kind === "candidate-host-operation" && equal(v.identity, identity2) && v.operation === action && v.planSha256 === reference2.sha256 && /^[a-f0-9]{64}$/.test(v.candidatePlanSha256) && v.holdState === (action === "observe-opened" ? "cleared" : "held") && v.ready === false && v.productionAvailabilityProven === false && (action === "rebind-held-epoch-for-reblock" || action === "prepare-resume-intent" || /^[a-f0-9]{64}$/.test(v.observationSha256)), "PERSISTENT_CANDIDATE_READBACK");
        if (action === "observe-opened" && !unknown) accepted = true;
        if (candidateSafetyActions.includes(action)) accepted = false;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async migrateExactPlan(identity2) {
      requireProof(driver && binding2 && !unknown && equal(identity2, spec.identity) && spec.sourcePlan.migrationAuthorization, "PERSISTENT_MIGRATION_AUTHORIZATION");
      try {
        const reply = await driver.request({ operation: "migrate-exact-plan", identity: identity2 });
        requireProof(Array.isArray(reply.value?.applied) && Array.isArray(reply.value?.skipped), "PERSISTENT_MIGRATION_RESULT");
        migrated = true;
        return reply.value;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async recoverRetainedBaseline(identity2, recoveryPlan) {
      const auth = spec.sourcePlan.recoveryAuthorization;
      requireProof(driver && binding2 && !unknown && equal(identity2, spec.identity) && auth && auth.identity && equal(auth.identity, identity2) && Number.isSafeInteger(auth.operationTimeoutMs) && auth.operationTimeoutMs >= 1e4 && auth.operationTimeoutMs <= 18e5 && equal(recoveryPlan, { path: auth.planPath, sha256: auth.planSha256 }), "PERSISTENT_RECOVERY_AUTHORIZATION");
      try {
        const reply = await driver.request({ operation: "recover-retained-baseline", identity: identity2, recoveryPlan }), v = reply.value;
        requireProof(v?.schemaVersion === 1 && v.kind === "production-recovery-completed" && equal(v.identity, identity2) && /^[a-f0-9]{64}$/.test(v.receiptSha256) && v.writesHeld === true && v.ready === false, "PERSISTENT_RECOVERY_READBACK");
        return v;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async recordMigrationCompletion(identity2, stage, receipt) {
      requireProof(driver && binding2 && !unknown && migrated && equal(identity2, spec.identity) && (stage === "intent" || stage === "durable") && receipt.path === `/etc/workspacex-cn/migration-completion-inputs/${identity2.sourceRevision}/${identity2.attemptId}.completed.json` && /^[a-f0-9]{64}$/.test(receipt.sha256), "PERSISTENT_MIGRATION_COMPLETION_BINDING");
      try {
        const reply = await driver.request({ operation: "record-migration-completion", identity: identity2, stage, receipt });
        requireProof(reply.value?.stage === stage && reply.value.ready === false && equal(reply.value.identity, identity2) && equal(reply.value.receipt, receipt), "PERSISTENT_MIGRATION_COMPLETION_READBACK");
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async readRunDrain(identity2) {
      requireProof(driver && binding2 && !unknown && equal(identity2, spec.identity), "PERSISTENT_DRAIN_IDENTITY");
      try {
        const reply = await driver.request({ operation: "read-run-drain", identity: identity2 });
        const v = reply.value;
        requireProof(v && v.writesHeld === true && typeof v.holdGeneration === "string" && /^[a-f0-9]{32}$/.test(v.holdGeneration) && equal(v.identity, identity2) && sealedRecord && v.holdGeneration === sealedRecord.runtimePlan.holdGeneration && equal(v.connection, sealedRecord.runtimePlan.diagnosticSessions.workspacex) && typeof v.observedAt === "number" && Date.now() / 1e3 - v.observedAt >= 0 && Date.now() / 1e3 - v.observedAt <= 30 && ["queued", "running", "writebackPending"].every((k) => Number.isSafeInteger(v[k]) && v[k] >= 0), "PERSISTENT_DRAIN_READBACK");
        return { queued: v.queued, running: v.running, writebackPending: v.writebackPending };
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async readDiagnosticLedger(identity2) {
      requireProof(driver && binding2 && !unknown && equal(identity2, spec.identity), "PERSISTENT_DIAGNOSTIC_IDENTITY");
      try {
        const reply = await driver.request({ operation: "read-diagnostic-ledger", identity: identity2 });
        requireProof(Array.isArray(reply.value?.ledger) && reply.value.rowCount === reply.value.ledger.length && typeof reply.value.observedAt === "number" && sealedRecord && equal(reply.value.connection, sealedRecord.runtimePlan.diagnosticSessions.workspacex), "PERSISTENT_DIAGNOSTIC_LEDGER");
        return reply.value;
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    async closeAfterAccepted() {
      requireProof(driver && accepted && !unknown, "PERSISTENT_WRITER_CLOSE_NOT_ACCEPTED");
      try {
        const reply = await driver.request({ operation: "close-accepted", identity: spec.identity });
        requireProof(reply.closed === true, "PERSISTENT_WRITER_CLOSE_READBACK");
        await driver.close();
      } catch (error) {
        unknown = true;
        driver.retain();
        throw error;
      }
    },
    retainUnknown() {
      unknown = true;
      driver?.retain();
    }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts
var issued = /* @__PURE__ */ new WeakMap();
var need = (v, c) => {
  if (!v) throw Error(c);
};
var rawHash = (raw) => (0, import_node_crypto4.createHash)("sha256").update(raw).digest("hex");
function readOriginalPlanAuthority(host, tool, profile, readBytes = protectedPrivateBytes) {
  const path2 = host.writerPlanPath, pin = host.writerPlanSha256;
  need(profile.originalWriterPlan && Object.keys(profile.originalWriterPlan).sort().join(",") === "path,sha256" && profile.originalWriterPlan.path === path2 && profile.originalWriterPlan.sha256 === pin, "ORIGINAL_PLAN_PROFILE_REF");
  need(path2.startsWith("/etc/workspacex-cn/") && !path2.split("/").includes("..") && /^[a-f0-9]{64}$/.test(pin) && /^[a-f0-9]{40}$/.test(tool), "ORIGINAL_PLAN_REF");
  const source2 = JSON.parse(readBytes(path2, pin).toString("utf8"));
  const identity2 = source2.identity;
  need(source2.schemaVersion === 1 && source2.mode === "maintenance-all-writer-fence" && source2.productionActionsAuthorized === true && source2.runtimeSessionBootstrapAuthorized === true && !["runtimeSourcePlanSha256", "runtimePlan", "controlSessions", "diagnosticSessions"].some((k) => k in source2), "ORIGINAL_PLAN_SCHEMA");
  need(identity2 && Object.keys(identity2).sort().join(",") === "attemptId,baselineRevision,migrationPlanSha256,sourceRevision" && /^[a-f0-9]{40}$/.test(identity2.sourceRevision) && identity2.baselineRevision === "ba6343199f3c834d6a198f83d0c771614292c82b" && /^[a-f0-9]{64}$/.test(identity2.migrationPlanSha256) && /^[A-Za-z0-9-]{1,128}$/.test(identity2.attemptId) && runtimeDigest(identity2) === runtimeDigest(host.identity) && source2.toolRevision === tool && profile.toolRevision === tool, "ORIGINAL_PLAN_IDENTITY");
  const capability = profile.maintenanceSourceOperations;
  need(capability?.schemaVersion === 1 && capability.sourcePath === ".harness/scripts/vm/maintenance_source_operations.py" && /^[a-f0-9]{64}$/.test(capability.sha256) && profile.filesSha256?.[capability.sourcePath] === capability.sha256 && profile.installedFilesSha256?.["/usr/local/lib/workspacex-cn/maintenance_source_operations.py"] === capability.sha256, "ORIGINAL_PLAN_SOURCE_CAPABILITY");
  for (const command3 of [host.hold, host.writerFence]) need(profile.installedFilesSha256?.[command3.path] === command3.sha256, "ORIGINAL_PLAN_HOST_PIN");
  const profilePin = runtimeDigest(profile), raw = readBytes(path2, pin);
  need(runtimeDigest(JSON.parse(readBytes("/etc/workspacex-cn/trusted-tool-binding.json").toString("utf8"))) === profilePin, "ORIGINAL_PLAN_PROFILE_PROVENANCE");
  need(rawHash(raw) === pin && runtimeDigest(JSON.parse(raw.toString("utf8"))) === runtimeDigest(source2), "ORIGINAL_PLAN_RAW");
  need(host.writerPlanCanonicalSha256 === runtimeDigest(source2), "ORIGINAL_PLAN_CANONICAL_BINDING");
  const freeze = (v) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  const result = freeze({ identity: { ...identity2 }, toolRevision: tool, sourcePlanPath: path2, sourcePlanSha256: pin, sourcePlanCanonicalSha256: runtimeDigest(source2), sourcePlan: source2 });
  issued.set(result, () => {
    need(runtimeDigest(profile) === profilePin && runtimeDigest(JSON.parse(readBytes("/etc/workspacex-cn/trusted-tool-binding.json").toString("utf8"))) === profilePin, "ORIGINAL_PLAN_AUTHORITY_DRIFT");
    need(rawHash(readBytes(path2, pin)) === pin, "ORIGINAL_PLAN_RAW_DRIFT");
  });
  return result;
}
function assertSourcePlanAuthority(authority, identity2, tool) {
  need(authority && issued.has(authority), "ORIGINAL_PLAN_AUTHORITY_REQUIRED");
  need(runtimeDigest(authority.identity) === runtimeDigest(identity2) && authority.toolRevision === tool, "ORIGINAL_PLAN_EXPECTED_IDENTITY");
  issued.get(authority)();
}
function assertPreholdArchiveAuthority(authority, policy) {
  need(authority && issued.has(authority), "ORIGINAL_PLAN_AUTHORITY_REQUIRED");
  assertSourcePlanAuthority(authority, authority.identity, authority.toolRevision);
  if (runtimeDigest(policy.binding.identity) === runtimeDigest(authority.identity) && policy.binding.toolRevision === authority.toolRevision) return;
  need(policy.binding.toolRevision === authority.toolRevision && ["sourceRevision", "baselineRevision", "migrationPlanSha256"].every((k) => policy.binding.identity[k] === authority.identity[k]), "PREHOLD_ARCHIVE_CURRENT_SCOPE");
  const approved = authority.sourcePlan.preholdArchivePolicy;
  need(approved && typeof approved === "object" && !Array.isArray(approved) && Object.keys(approved).sort().join(",") === "binding,input,outputRoot,sourcePolicy", "PREHOLD_ARCHIVE_POLICY_REQUIRED");
  const actual2 = { binding: policy.binding, input: policy.input, sourcePolicy: policy.sourcePolicy, outputRoot: policy.outputRoot };
  need(runtimeDigest(approved) === runtimeDigest(actual2), "PREHOLD_ARCHIVE_POLICY_BINDING");
}

// packages/cloud-deploy/src/cn-candidate-compose-source.ts
var requestSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  config: external_exports.unknown(),
  manifest: external_exports.unknown(),
  options: external_exports.object({ projectName: external_exports.string(), runtimeDirectory: external_exports.string() }).strict()
}).strict();
function emitCandidateComposeSource(input, authority, approvedManifest) {
  const request = requestSchema.parse(input);
  assertSourcePlanAuthority(authority, authority?.identity, authority?.toolRevision);
  const config = deploymentConfigSchema.parse(request.config);
  const manifest = validateReleaseManifest(request.manifest);
  const approved = validateReleaseManifest(approvedManifest);
  if (config.environment.profile !== "production" || request.sourceRevision !== authority.identity.sourceRevision || manifest.sourceRevision !== authority.identity.sourceRevision || approved.sourceRevision !== authority.identity.sourceRevision || runtimeDigest(manifest) !== runtimeDigest(approved) || config.provision.release !== approved.release || manifest.platform !== "linux/amd64") throw new Error("CANDIDATE_COMPOSE_APPROVED_SOURCE_REQUIRED");
  return {
    ...createCloudCompose(config, manifest, request.options),
    networks: { default: { external: true, name: `${request.options.projectName}-runtime` } }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/entry.ts
var import_node_crypto14 = require("node:crypto");
var import_node_fs9 = require("node:fs");

// packages/cloud-deploy/src/cn-maintenance-host/production_factory.ts
var productionActions = ["prepareOffline", "verifyThreeDatabaseRecovery", "migrateExactPlan", "verifyProductionDynamic", "verifyPreactivate", "activate", "verifyAcceptance"];
function productionPrimitives(binding2, run, verifyInstalledProfile, inheritedLock) {
  const identityEqual = (value) => !!value && typeof value === "object" && Object.keys(value).sort().join(",") === Object.keys(binding2.identity).sort().join(",") && Object.entries(binding2.identity).every(([key, expected]) => value[key] === expected);
  const validate = () => {
    if (!/^[a-f0-9]{40}$/.test(binding2.toolRevision) || !identityEqual(binding2.identity)) throw new Error("PRODUCTION_BINDING_INVALID");
    if (Object.keys(binding2.operations).sort().join(",") !== [...productionActions].sort().join(",")) throw new Error("PRODUCTION_OPERATION_SET_INVALID");
    for (const op of [binding2.recoveryPreflight, ...productionActions.map((k) => binding2.operations[k])]) {
      if (!op || !op.planPath.startsWith("/etc/workspacex-cn/") || op.planPath.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(op.planSha256) || !op.command.path.startsWith("/usr/local/lib/workspacex-cn/") || !/^[a-f0-9]{64}$/.test(op.command.sha256)) throw new Error("PRODUCTION_OPERATION_BINDING_INVALID");
    }
  };
  const invoke = async (name, op, identity2) => {
    if (!identityEqual(identity2)) throw new Error("PRODUCTION_IDENTITY_CHANGED");
    const response = await run(op.command, ["--maintenance-operation", name, op.planPath, op.planSha256]);
    let value;
    try {
      value = JSON.parse(response.stdout);
    } catch {
      throw new Error("PRODUCTION_OPERATION_RESPONSE_INVALID");
    }
    if (!value || value.schemaVersion !== 1 || value.kind !== "maintenance-operation-completed" || value.operation !== name || !identityEqual(value.identity) || value.toolRevision !== binding2.toolRevision || value.planSha256 !== op.planSha256 || value.ready !== false) throw new Error("PRODUCTION_OPERATION_RESPONSE_INVALID");
  };
  const startup = productionStartupPrimitives(binding2, run, verifyInstalledProfile, inheritedLock);
  const result = {
    ...startup,
    assertTrustedBinding: async (host) => {
      validate();
      await startup.assertTrustedBinding(host);
    },
    ...Object.fromEntries(productionActions.map((name) => [name, (identity2) => invoke(name, binding2.operations[name], identity2)]))
  };
  return result;
}
function productionStartupPrimitives(binding2, run, verifyInstalledProfile, inheritedLock) {
  const same6 = (a) => !!a && typeof a === "object" && Object.keys(a).length === 4 && Object.entries(binding2.identity).every(([k, v]) => a[k] === v);
  return {
    assertTrustedBinding: async (host) => {
      if (!/^[a-f0-9]{40}$/.test(binding2.toolRevision) || !same6(host.identity)) throw Error("PRODUCTION_BINDING_INVALID");
      await verifyInstalledProfile(host, binding2);
    },
    verifyRecoveryExecutorCapability: async (identity2) => {
      if (!same6(identity2)) throw Error("PRODUCTION_IDENTITY_CHANGED");
      const op = binding2.recoveryPreflight;
      if (op.command.path !== "/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py" || !op.planPath.startsWith("/etc/workspacex-cn/maintenance-recovery/") || !/^[a-f0-9]{64}$/.test(op.planSha256)) throw Error("RECOVERY_PREFLIGHT_BINDING");
      const result = await run(op.command, ["--preflight-capability", op.planPath]);
      let v;
      try {
        v = JSON.parse(result.stdout);
      } catch {
        throw Error("RECOVERY_PREFLIGHT_INVALID");
      }
      if (v.schemaVersion !== 1 || v.kind !== "production-recovery-preflight" || !same6(v.identity) || v.toolRevision !== binding2.toolRevision || v.planSha256 !== op.planSha256 || v.liveWritesHeldProven !== false || v.ready !== false) throw Error("RECOVERY_PREFLIGHT_INVALID");
    },
    acquireReleaseLock: inheritedLock
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/production_consumers.ts
var import_node_fs8 = require("node:fs");

// packages/cloud-deploy/src/cn-maintenance-host/migration_transport.ts
var import_node_crypto9 = require("node:crypto");
var import_node_fs5 = require("node:fs");
var import_node_path3 = require("node:path");
var import_node_crypto10 = require("node:crypto");

// packages/cloud-deploy/src/cn-migration-plan.ts
var import_node_crypto5 = require("node:crypto");
var import_node_child_process4 = require("node:child_process");
var import_node_fs3 = require("node:fs");
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var sha = /^[a-f0-9]{40}$/;
var hash2 = /^[a-f0-9]{64}$/;
var migrationHash = (value) => (0, import_node_crypto5.createHash)("sha256").update(value).digest("hex");
var canonicalHash = (value) => migrationHash(JSON.stringify(value));
var compare = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
function classifyMigration(sql) {
  const text2 = sql.replace(/--[^\n]*(?:\n|$)/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (/\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i.test(text2) || /\bALTER\b[\s\S]*\bRENAME\b/i.test(text2)) return "destructive";
  if (/\$|['"]|\/\*|\*\//.test(text2)) return "unknown";
  const statements = text2.split(";").map((part) => part.trim()).filter(Boolean);
  if (!statements.length) return "unknown";
  const identifier2 = "[A-Za-z_][A-Za-z0-9_]*";
  const type = "(?:smallint|integer|bigint|text|boolean|uuid|date|timestamp|timestamptz|jsonb|real|double precision)";
  const column = `${identifier2}\\s+${type}(?:\\s+(?:NOT NULL|NULL|PRIMARY KEY|UNIQUE))*`;
  const table = new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier2}\\s*\\(\\s*${column}(?:\\s*,\\s*${column})*\\s*\\)$`, "i");
  const index = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier2}\\s+ON\\s+${identifier2}\\s*\\(\\s*${identifier2}(?:\\s*,\\s*${identifier2})*\\s*\\)$`, "i");
  if (statements.every((statement) => table.test(statement) || index.test(statement))) return "additive";
  if (statements.every((statement) => /^ALTER\s+TABLE\s+/i.test(statement))) return "contract";
  return "unknown";
}
function compareMigrationInventory(input, files) {
  const blockers = [];
  if (!sha.test(input.targetSha) || !sha.test(input.baselineSha)) blockers.push("invalid_exact_sha");
  const ledger = input.ledger.map(({ name, checksum }) => ({ name, checksum })).sort(compare);
  const names = /* @__PURE__ */ new Set();
  for (const entry of ledger) {
    if (!entry.name.endsWith(".sql") || entry.name.includes("/") || entry.name.includes("\\") || !hash2.test(entry.checksum)) blockers.push("invalid_ledger_entry");
    if (names.has(entry.name)) blockers.push(`duplicate_ledger:${entry.name}`);
    names.add(entry.name);
  }
  const sourceNames = /* @__PURE__ */ new Set();
  let previous;
  for (const file of files) {
    if (sourceNames.has(file.name) || previous !== void 0 && previous >= file.name) blockers.push(`invalid_source_order:${file.name}`);
    if (!hash2.test(file.checksum) || migrationHash(file.sql) !== file.checksum) blockers.push(`source_checksum_mismatch:${file.name}`);
    sourceNames.add(file.name);
    previous = file.name;
  }
  const drift = [];
  for (const applied of ledger) {
    const source2 = files.find((file) => file.name === applied.name);
    if (!source2) {
      blockers.push(`applied_source_missing:${applied.name}`);
      continue;
    }
    if (source2.checksum !== applied.checksum) {
      const supplied = input.legacyDriftEvidence?.find((item) => item.name === applied.name);
      const evidence = supplied && supplied.ledgerChecksum === applied.checksum && supplied.sourceChecksum === source2.checksum && supplied.baselineSourceChecksum === source2.checksum && supplied.runningImageSourceChecksum === source2.checksum && hash2.test(supplied.evidenceSha256) ? {
        name: supplied.name,
        ledgerChecksum: supplied.ledgerChecksum,
        sourceChecksum: supplied.sourceChecksum,
        baselineSourceChecksum: supplied.baselineSourceChecksum,
        runningImageSourceChecksum: supplied.runningImageSourceChecksum,
        evidenceSha256: supplied.evidenceSha256
      } : null;
      drift.push({ name: applied.name, ledgerChecksum: applied.checksum, sourceChecksum: source2.checksum, evidence });
      blockers.push(`applied_checksum_drift:${applied.name}`);
      if (!evidence) blockers.push(`legacy_drift_evidence_missing:${applied.name}`);
    }
  }
  const pending = files.filter((file) => !names.has(file.name)).map((file) => ({ name: file.name, checksum: file.checksum, risk: classifyMigration(file.sql) }));
  for (const file of pending) if (file.risk !== "additive") blockers.push(`pending_${file.risk}:${file.name}`);
  const lastApplied = ledger.at(-1)?.name;
  for (const file of pending) if (lastApplied && file.name < lastApplied) blockers.push(`out_of_order_pending:${file.name}`);
  if (input.snapshotEvidence && (input.snapshotEvidence.ledgerSha256 !== canonicalHash(ledger) || input.snapshotEvidence.independentSqlCount !== ledger.length)) blockers.push("snapshot_inventory_binding_mismatch");
  const body = {
    schemaVersion: 1,
    targetSha: input.targetSha,
    baselineSha: input.baselineSha,
    baselineLedgerSha256: canonicalHash(ledger),
    sourceInventorySha256: canonicalHash(files.map(({ name, checksum }) => ({ name, checksum }))),
    pendingSha256: canonicalHash(pending.map(({ name, checksum }) => ({ name, checksum }))),
    ...input.snapshotEvidence ? { snapshotEvidence: input.snapshotEvidence } : {},
    ledger,
    pending,
    drift,
    blockers: [...new Set(blockers)].sort(),
    ready: blockers.length === 0,
    scope: "read-only-plan",
    productionMigrationAuthorized: false
  };
  return { ...body, planSha256: canonicalHash(body) };
}
async function generateMigrationPlan(checkout, input) {
  const root = (0, import_node_fs3.realpathSync)((0, import_node_path.resolve)(checkout));
  const git = (...args) => (0, import_node_child_process4.execFileSync)("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  if (!sha.test(input.targetSha) || git("rev-parse", "HEAD") !== input.targetSha) throw new Error("target checkout SHA mismatch");
  const migratorPath = "apps/api/src/infrastructure/db/migrator.ts";
  const migrationPath = "apps/api/migrations";
  if (git("status", "--porcelain", "--untracked-files=all", "--", migratorPath, migrationPath)) throw new Error("migration source is not frozen");
  const authority = await import((0, import_node_url.pathToFileURL)((0, import_node_path.join)(root, migratorPath)).href);
  if (typeof authority.migrationFiles !== "function") throw new Error("canonical migrationFiles authority missing");
  const dir = (0, import_node_path.join)(root, migrationPath);
  const files = authority.migrationFiles(dir).map((name) => {
    const path2 = (0, import_node_path.join)(dir, name);
    if (!(0, import_node_fs3.lstatSync)(path2).isFile() || (0, import_node_fs3.realpathSync)(path2) !== path2) throw new Error(`migration must be a regular tracked file: ${name}`);
    const sql = (0, import_node_fs3.readFileSync)(path2, "utf8");
    if (git("ls-files", "--error-unmatch", "--", `${migrationPath}/${name}`) !== `${migrationPath}/${name}` || migrationHash((0, import_node_child_process4.execFileSync)("git", ["-C", root, "show", `${input.targetSha}:${migrationPath}/${name}`])) !== migrationHash(sql)) throw new Error(`migration differs from target: ${name}`);
    return { name, checksum: migrationHash(sql), sql };
  });
  return compareMigrationInventory(input, files);
}

// packages/cloud-deploy/src/cn-migration-snapshot.ts
var import_node_crypto6 = require("node:crypto");
var import_node_zlib = require("node:zlib");
var import_node_util2 = require("node:util");
var hash3 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var id2 = external_exports.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
var utc = external_exports.string().datetime({ offset: false });
var count = external_exports.number().int().nonnegative().max(1e5);
var source = migrationSourceSchema;
var migrationSnapshotBindingSchema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  source,
  sourceEvidence: sourceEvidenceSchema,
  cloud: external_exports.object({ ecsInstanceId: id2, invokeId: id2, commandId: id2, querySha256: hash3 }).strict()
}).strict();
var envelope = external_exports.object({
  schemaVersion: external_exports.literal(2),
  kind: external_exports.literal("cn-readonly-migration-snapshot"),
  capturedAt: utc,
  source,
  fullResponseBase64: external_exports.string().min(1),
  fullResponseSha256: hash3
}).strict();
var row = external_exports.object({ name: external_exports.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/).max(255), checksum: hash3 }).strict();
var payload = external_exports.object({
  schemaVersion: external_exports.literal(2),
  kind: external_exports.literal("cn-migration-ledger-output"),
  querySha256: hash3,
  readOnly: external_exports.literal(true),
  transactionIsolation: external_exports.literal("repeatable read"),
  source,
  independentSqlCount: count,
  ledger: external_exports.array(row).max(1e5),
  ledgerSha256: hash3
}).strict();
var sha256 = (input) => (0, import_node_crypto6.createHash)("sha256").update(input).digest("hex");
function migrationLedgerDigest(ledger) {
  return sha256(JSON.stringify([...ledger].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}
var MigrationSnapshotError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "MigrationSnapshotError";
  }
};
function fail2(code) {
  throw new MigrationSnapshotError(code);
}
function parse(schema3, value) {
  const result = schema3.safeParse(value);
  if (!result.success) fail2("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
  return result.data;
}
function decode64(value, max) {
  if (value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail2("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length > max) fail2("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  return bytes;
}
function json(bytes) {
  try {
    return JSON.parse(new import_node_util2.TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail2("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  }
}
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail2("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  return value;
}
function validateMigrationSnapshot(value, expectedValue) {
  const expected = parse(migrationSnapshotBindingSchema, expectedValue);
  const input = parse(envelope, value);
  if (!verifyExternalSourceIdentity(expected.source, expected.sourceEvidence)) fail2("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
  if (JSON.stringify(input.source) !== JSON.stringify(expected.source)) fail2("MIGRATION_SNAPSHOT_SOURCE_MISMATCH");
  const bytes = decode64(input.fullResponseBase64, 2 * 1024 * 1024);
  if (sha256(bytes) !== input.fullResponseSha256) fail2("MIGRATION_SNAPSHOT_RESPONSE_HASH_MISMATCH");
  const response = object(json(bytes));
  if (typeof response.RequestId !== "string" || !response.RequestId || response.NextToken !== void 0 && response.NextToken !== "") fail2("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const invocation = object(response.Invocation);
  if (invocation.TotalCount !== 1 || invocation.NextToken !== void 0 && invocation.NextToken !== "") fail2("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const results = object(invocation.InvocationResults).InvocationResult;
  if (!Array.isArray(results) || results.length !== 1) fail2("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const result = object(results[0]);
  if (result.Dropped !== 0) fail2("MIGRATION_SNAPSHOT_OUTPUT_DROPPED");
  if (result.ExitCode !== 0 || result.InvocationStatus !== "Success" || result.ErrorCode !== void 0 && result.ErrorCode !== "") fail2("MIGRATION_SNAPSHOT_COMMAND_FAILED");
  if (result.InstanceId !== expected.cloud.ecsInstanceId || result.InvokeId !== expected.cloud.invokeId || result.CommandId !== expected.cloud.commandId) fail2("MIGRATION_SNAPSHOT_CLOUD_IDENTITY_MISMATCH");
  if (!utc.safeParse(result.FinishedTime).success || typeof result.Output !== "string") fail2("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  const finished = Date.parse(result.FinishedTime);
  if (Date.parse(input.capturedAt) < finished) fail2("MIGRATION_SNAPSHOT_TIME_INVALID");
  const prefix = "WSX_CN_MIGRATION_SNAPSHOT_V2=";
  let output;
  try {
    output = new import_node_util2.TextDecoder("utf-8", { fatal: true }).decode(decode64(result.Output, 24 * 1024));
  } catch {
    return fail2("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  }
  if (!output.startsWith(prefix) || !/^WSX_CN_MIGRATION_SNAPSHOT_V2=[A-Za-z0-9+/]+={0,2}\n?$/.test(output)) fail2("MIGRATION_SNAPSHOT_OUTPUT_INVALID");
  let decoded;
  try {
    decoded = json((0, import_node_zlib.gunzipSync)(decode64(output.slice(prefix.length).trimEnd(), 24 * 1024), { maxOutputLength: 8 * 1024 * 1024 }));
  } catch {
    return fail2("MIGRATION_SNAPSHOT_OUTPUT_INVALID");
  }
  const sql = parse(payload, decoded);
  if (JSON.stringify(sql.source) !== JSON.stringify(expected.source) || sql.querySha256 !== expected.cloud.querySha256) fail2("MIGRATION_SNAPSHOT_SQL_IDENTITY_MISMATCH");
  if (sql.independentSqlCount !== sql.ledger.length) fail2("MIGRATION_SNAPSHOT_COUNT_MISMATCH");
  if (new Set(sql.ledger.map((item) => item.name)).size !== sql.ledger.length) fail2("MIGRATION_SNAPSHOT_DUPLICATE_NAME");
  if (migrationLedgerDigest(sql.ledger) !== sql.ledgerSha256) fail2("MIGRATION_SNAPSHOT_LEDGER_HASH_MISMATCH");
  return {
    ledger: [...sql.ledger].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    sourceBindingSha256: sha256(JSON.stringify(expected)),
    snapshotSha256: sha256(JSON.stringify(input)),
    fullResponseSha256: input.fullResponseSha256,
    ledgerSha256: sql.ledgerSha256,
    independentSqlCount: sql.independentSqlCount,
    capturedAt: input.capturedAt,
    scope: "validated-private-read-only-snapshot"
  };
}

// packages/cloud-deploy/src/cn-migration-completion.ts
function reject(code) {
  throw new Error(`MIGRATION_COMPLETION_${code}`);
}
async function verifyMigrationCompletion(snapshotInput, bindingInput, checkout, expected, now = /* @__PURE__ */ new Date(), ttlMs = 36e5) {
  if (!releaseManifestSchema.shape.sourceRevision.safeParse(expected.sourceRevision).success || !releaseManifestSchema.shape.sourceRevision.safeParse(expected.baselineRevision).success || !releaseManifestSchema.shape.release.safeParse(expected.release).success || typeof expected.attemptId !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(expected.attemptId) || typeof expected.originalPlanSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expected.originalPlanSha256)) reject("RELEASE_BINDING_INVALID");
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 36e5) reject("FRESHNESS_WINDOW_INVALID");
  const binding2 = migrationSnapshotBindingSchema.parse(bindingInput);
  const productionSource = migrationSourceSchema.parse(expected.productionSource);
  if (JSON.stringify(binding2.source) !== JSON.stringify(productionSource)) reject("PRODUCTION_TARGET_MISMATCH");
  const snapshot2 = validateMigrationSnapshot(snapshotInput, binding2);
  const response = JSON.parse(Buffer.from(snapshotInput.fullResponseBase64, "base64").toString("utf8"));
  const finishedAt = response.Invocation.InvocationResults.InvocationResult[0].FinishedTime;
  for (const timestamp of [snapshot2.capturedAt, finishedAt]) {
    const observed = Date.parse(timestamp);
    if (!Number.isFinite(observed) || observed > now.getTime() || now.getTime() - observed >= ttlMs) reject("SNAPSHOT_NOT_FRESH");
  }
  const original = expected.originalPlan;
  if (!original || original.targetSha !== expected.sourceRevision || original.baselineSha !== expected.baselineRevision || original.planSha256 !== expected.originalPlanSha256 || original.drift.length !== 0) reject("ORIGINAL_PLAN_BINDING_INVALID");
  const recomputed = await generateMigrationPlan(checkout, {
    targetSha: expected.sourceRevision,
    baselineSha: expected.baselineRevision,
    ledger: original.ledger,
    ...original.snapshotEvidence ? { snapshotEvidence: original.snapshotEvidence } : {}
  });
  if (recomputed.planSha256 !== expected.originalPlanSha256) reject("ORIGINAL_PLAN_CHANGED");
  const after = await generateMigrationPlan(checkout, {
    targetSha: expected.sourceRevision,
    baselineSha: expected.baselineRevision,
    ledger: snapshot2.ledger,
    snapshotEvidence: {
      snapshotSha256: snapshot2.snapshotSha256,
      sourceBindingSha256: snapshot2.sourceBindingSha256,
      fullResponseSha256: snapshot2.fullResponseSha256,
      ledgerSha256: snapshot2.ledgerSha256,
      independentSqlCount: snapshot2.independentSqlCount,
      capturedAt: snapshot2.capturedAt
    }
  });
  if (after.sourceInventorySha256 !== recomputed.sourceInventorySha256 || after.pending.length !== 0 || after.drift.length !== 0 || after.blockers.length !== 0 || !after.ready) reject("LEDGER_INCOMPLETE_OR_DRIFTED");
  return {
    schemaVersion: 1,
    scope: "validated-production-migration-completion",
    sourceRevision: expected.sourceRevision,
    baselineRevision: expected.baselineRevision,
    attemptId: expected.attemptId,
    release: expected.release,
    originalPlanSha256: expected.originalPlanSha256,
    completionPlanSha256: after.planSha256,
    sourceInventorySha256: after.sourceInventorySha256,
    sourceBindingSha256: snapshot2.sourceBindingSha256,
    snapshotSha256: snapshot2.snapshotSha256,
    fullResponseSha256: snapshot2.fullResponseSha256,
    ledgerSha256: snapshot2.ledgerSha256,
    appliedSqlCount: snapshot2.independentSqlCount,
    pendingCount: 0,
    driftCount: 0,
    unknownAppliedCount: 0,
    capturedAt: snapshot2.capturedAt,
    providerFinishedAt: finishedAt,
    expiresAt: new Date(Math.min(Date.parse(snapshot2.capturedAt), Date.parse(finishedAt)) + ttlMs).toISOString(),
    productionMutationAuthorized: false
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/native_completion.ts
var hash4 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var stamp = external_exports.string().datetime();
var nativeCompletionSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  scope: external_exports.literal("validated-production-migration-completion"),
  sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  baselineRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  attemptId: external_exports.string(),
  release: external_exports.literal("2026.10.3-cn.1"),
  originalPlanSha256: hash4,
  completionPlanSha256: hash4,
  sourceInventorySha256: hash4,
  sourceBindingSha256: hash4,
  snapshotSha256: hash4,
  fullResponseSha256: hash4,
  ledgerSha256: hash4,
  appliedSqlCount: external_exports.number().int().nonnegative().safe(),
  pendingCount: external_exports.literal(0),
  driftCount: external_exports.literal(0),
  unknownAppliedCount: external_exports.literal(0),
  capturedAt: stamp,
  providerFinishedAt: stamp,
  expiresAt: stamp,
  productionMutationAuthorized: external_exports.literal(false)
}).strict();
function readNativeCompletion(value, identity2, now = Date.now()) {
  const v = nativeCompletionSchema.parse(value);
  if (v.sourceRevision !== identity2.sourceRevision || v.baselineRevision !== identity2.baselineRevision || v.attemptId !== identity2.attemptId || v.originalPlanSha256 !== identity2.migrationPlanSha256) throw Error("NATIVE_COMPLETION_IDENTITY");
  const captured = Date.parse(v.capturedAt), finished = Date.parse(v.providerFinishedAt), expires = Date.parse(v.expiresAt);
  if (!Number.isFinite(now) || [captured, finished].some((t) => t > now || now - t >= 36e5) || expires <= now || expires > Math.min(captured, finished) + 36e5 || expires <= Math.max(captured, finished)) throw Error("NATIVE_COMPLETION_FRESHNESS");
  return v;
}

// packages/cloud-deploy/src/cn-fast-safe-release.ts
var import_node_crypto7 = require("node:crypto");
var sha2 = external_exports.string().regex(/^[a-f0-9]{40}$/);
var sha2562 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var digest = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var terminalCheck = external_exports.object({ status: external_exports.literal("passed"), evidenceSha256: sha2562 }).strict();
var failureClass = external_exports.enum(["stale-test", "infrastructure", "product", "unknown"]);
var waiverSchema = external_exports.object({
  issueUrl: external_exports.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9][0-9]*$/),
  evidenceSha256: sha2562,
  owner: external_exports.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  expiresAt: external_exports.string().datetime()
}).strict();
var releaseFailureSchema = external_exports.object({
  check: external_exports.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  classification: failureClass,
  waiver: waiverSchema.optional()
}).strict();
var durableConfigSchema = external_exports.object({
  asrProfile: external_exports.literal(true),
  platformSuperuserEmails: external_exports.literal(true),
  githubIssueProfile: external_exports.literal(true),
  copilotkitExactTimeoutSeconds: external_exports.number().int().min(3600).max(3600),
  copilotkitPrefixTimeoutSeconds: external_exports.number().int().min(3600).max(3600)
}).strict();
var diffSchema = external_exports.object({
  migrationRisk: external_exports.enum(["none", "compatible", "destructive"]),
  pendingMigrationCount: external_exports.number().int().nonnegative(),
  changedServices: external_exports.array(external_exports.enum(["web", "api", "agent", "sandbox"])).max(4)
}).strict();
var migrationCompatibilitySchema = external_exports.object({
  baselineSourceRevision: sha2,
  sourceRevision: sha2,
  baselineSha256: sha2562,
  planSha256: sha2562,
  pendingSha256: sha2562,
  scope: external_exports.literal("restored-baseline-runtime"),
  sqlExecuted: external_exports.literal(true),
  cleanupPassed: external_exports.literal(true),
  oldRead: terminalCheck,
  oldWrite: terminalCheck,
  candidateRead: terminalCheck,
  candidateWrite: terminalCheck
}).strict();
var imageSetSchema = external_exports.object({ web: digest, api: digest, agent: digest, sandbox: digest }).strict();
var preparedCnReleaseSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  status: external_exports.literal("prepared").default("prepared"),
  sourceRevision: sha2,
  baselineSha256: sha2562,
  baselineSourceRevision: sha2.optional(),
  migrationPlanSha256: sha2562.optional(),
  pendingMigrationSha256: sha2562.optional(),
  migrationCompatibility: migrationCompatibilitySchema.optional(),
  release: external_exports.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  manifestSha256: sha2562,
  images: imageSetSchema,
  diff: diffSchema,
  durableConfig: durableConfigSchema,
  checks: external_exports.object({
    sourceFrozen: terminalCheck,
    imagesImmutable: terminalCheck,
    canonicalConfigRendered: terminalCheck,
    migrationAssessed: terminalCheck,
    databaseBackup: terminalCheck,
    shadowReadiness: terminalCheck,
    shadowBusiness: terminalCheck
  }).strict(),
  failures: external_exports.array(releaseFailureSchema).max(128),
  preparedAt: external_exports.string().datetime(),
  expiresAt: external_exports.string().datetime()
}).strict().superRefine((value, context) => {
  const prepared = Date.parse(value.preparedAt), expires = Date.parse(value.expiresAt);
  if (expires <= prepared || expires - prepared > 7 * 864e5) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["expiresAt"], message: "INVALID_PREPARATION_WINDOW" });
  }
  if (value.diff.migrationRisk === "destructive") {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["diff", "migrationRisk"], message: "DESTRUCTIVE_MIGRATION_REQUIRES_MAINTENANCE_LANE" });
  }
  if (value.diff.migrationRisk === "none" && value.diff.pendingMigrationCount !== 0) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["diff", "migrationRisk"], message: "NONEMPTY_PENDING_MIGRATIONS_REQUIRE_ASSESSMENT" });
  }
  if (value.diff.migrationRisk === "compatible") {
    const proof = value.migrationCompatibility;
    if (!proof || !value.baselineSourceRevision || !value.migrationPlanSha256 || !value.pendingMigrationSha256 || proof.sourceRevision !== value.sourceRevision || proof.baselineSourceRevision !== value.baselineSourceRevision || proof.baselineSha256 !== value.baselineSha256 || proof.planSha256 !== value.migrationPlanSha256 || proof.pendingSha256 !== value.pendingMigrationSha256 || value.checks.migrationAssessed.evidenceSha256 !== value.migrationPlanSha256) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["migrationCompatibility"], message: "EXACT_OLD_NEW_MIGRATION_PROOF_REQUIRED" });
    }
  }
  for (const [index, failure] of value.failures.entries()) {
    if (failure.waiver && Date.parse(failure.waiver.expiresAt) > expires) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["failures", index, "waiver", "expiresAt"], message: "WAIVER_OUTLIVES_PREPARATION" });
    }
  }
});
function validatePreparedCnRelease(input) {
  const result = preparedCnReleaseSchema.safeParse(input);
  if (!result.success) throw new Error("INVALID_PREPARED_CN_RELEASE");
  return result.data;
}
function verifyPreparedReleaseManifest(receiptInput, manifestBytes) {
  const receipt = validatePreparedCnRelease(receiptInput);
  let manifest;
  try {
    manifest = validateReleaseManifest(JSON.parse(manifestBytes.toString("utf8")));
  } catch {
    throw new Error("PREPARED_MANIFEST_INVALID");
  }
  if (manifest.sourceRevision !== receipt.sourceRevision || (0, import_node_crypto7.createHash)("sha256").update(manifestBytes).digest("hex") !== receipt.manifestSha256) throw new Error("PREPARED_MANIFEST_MISMATCH");
  for (const service of ["web", "api", "agent", "sandbox"]) {
    if (manifest.images[service].image.split("@").at(-1) !== receipt.images[service]) throw new Error("PREPARED_IMAGE_MISMATCH");
  }
  return manifest;
}
function classifyReleaseFailures(failures, now = /* @__PURE__ */ new Date()) {
  const blocked = [], waived = [];
  for (const failure of failures) {
    const eligible = failure.classification === "stale-test" || failure.classification === "infrastructure";
    const validWaiver = eligible && failure.waiver && Date.parse(failure.waiver.expiresAt) > now.getTime();
    (validWaiver ? waived : blocked).push(failure.check);
  }
  return { blocked, waived };
}
async function activatePreparedCnRelease(input, actions, options = {}) {
  const receipt = validatePreparedCnRelease(input), now = options.now ?? /* @__PURE__ */ new Date(), deadlineMs = options.deadlineMs ?? 3e5;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 3e5) throw new Error("INVALID_ACTIVATION_DEADLINE");
  const started = performance.now();
  const report = (status, code) => ({ status, code, durationMs: Math.round(performance.now() - started) });
  if (Date.parse(receipt.expiresAt) <= now.getTime()) return report("blocked", "PREPARATION_EXPIRED");
  if (classifyReleaseFailures(receipt.failures, now).blocked.length) return report("blocked", "PREPARATION_GATES_BLOCKED");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadlineMs);
  let promoted = false;
  const active = () => {
    if (controller.signal.aborted || performance.now() - started >= deadlineMs) throw new Error("ACTIVATION_DEADLINE_EXCEEDED");
  };
  try {
    if (await actions.readBaselineFingerprint() !== receipt.baselineSha256) return report("blocked", "BASELINE_CAS_MISMATCH");
    const drain = await actions.drainRuns();
    active();
    if ([drain.queued, drain.running, drain.writebackPending].some((value) => !Number.isSafeInteger(value) || value !== 0)) return report("blocked", "RUN_DRAIN_INCOMPLETE");
    await actions.promotePreparedPointer();
    promoted = true;
    active();
    await actions.activateTraffic();
    active();
    const canonical3 = await actions.verifyCanonical();
    active();
    if (canonical3.status !== "passed" || canonical3.lockRetained || canonical3.passedStages !== 8) throw new Error("CANONICAL_GATE_FAILED");
    const browser = await actions.runBrowserSmoke();
    active();
    if (!Object.values(browser).every((value) => value === true)) throw new Error("BROWSER_SMOKE_FAILED");
    return report("passed", "ACTIVATED");
  } catch (error) {
    if (!promoted) return report("blocked", "ACTIVATION_PRECONDITION_FAILED");
    const code = error instanceof Error && ["CANONICAL_GATE_FAILED", "BROWSER_SMOKE_FAILED"].includes(error.message) ? error.message : "ACTIVATION_FAILED";
    try {
      await actions.restoreBaseline();
      await actions.restorePointer();
      return report("rolled-back", code);
    } catch {
      return report("rollback-unproven", code);
    }
  } finally {
    clearTimeout(timer);
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/reused_actions.ts
function offlinePreparedAction(receipt, manifestBytes, verifyOfflineArtifacts) {
  return async (identity2) => {
    const prepared = validatePreparedCnRelease(receipt);
    const manifest = verifyPreparedReleaseManifest(receipt, manifestBytes);
    if (prepared.sourceRevision !== identity2.sourceRevision || manifest.sourceRevision !== identity2.sourceRevision) throw new Error("OFFLINE_APPLICATION_IDENTITY_MISMATCH");
    await verifyOfflineArtifacts();
  };
}
function exactMigrationAction(input, transport) {
  return async (identity2) => {
    if (input.plan.targetSha !== identity2.sourceRevision || input.plan.baselineSha !== identity2.baselineRevision || input.expectedCompletion.originalPlanSha256 !== identity2.migrationPlanSha256 || input.expectedCompletion.attemptId !== identity2.attemptId || input.expectedCompletion.sourceRevision !== identity2.sourceRevision || input.expectedCompletion.baselineRevision !== identity2.baselineRevision) throw new Error("EXACT_MIGRATION_BINDING_MISMATCH");
    if (!migrationSourceSchema.safeParse(input.expectedCompletion.productionSource).success) throw new Error("EXACT_MIGRATION_PRODUCTION_SOURCE_INVALID");
    const recomputed = await generateMigrationPlan(input.checkout, input.plan);
    const permitted = /* @__PURE__ */ new Set(["pending_contract", "pending_destructive"]);
    if (recomputed.planSha256 !== identity2.migrationPlanSha256 || recomputed.drift.length || recomputed.blockers.some((code) => !permitted.has(code))) throw new Error("EXACT_MIGRATION_PLAN_CHANGED_OR_UNSAFE");
    if (!input.expectedCompletion.originalPlan || JSON.stringify(input.expectedCompletion.originalPlan) !== JSON.stringify(recomputed)) throw new Error("EXACT_MIGRATION_ORIGINAL_PLAN_CHANGED");
    await transport.verifyLiveWriterBarrier();
    const result = await transport.migrate();
    if (JSON.stringify(result.applied) !== JSON.stringify(recomputed.pending.map((x) => x.name)) || JSON.stringify(result.skipped) !== JSON.stringify(recomputed.ledger.map((x) => x.name))) throw new Error("EXACT_MIGRATION_APPLIED_SET_MISMATCH");
    await transport.verifyLiveWriterBarrier();
    const after = await transport.readFreshCompletion();
    await verifyMigrationCompletion(after.snapshot, after.binding, input.checkout, input.expectedCompletion);
  };
}
function preparedActivationAction(receipt, actions) {
  return async (identity2) => {
    const prepared = validatePreparedCnRelease(receipt);
    if (prepared.sourceRevision !== identity2.sourceRevision) throw new Error("ACTIVATION_IDENTITY_MISMATCH");
    const report = await activatePreparedCnRelease(receipt, actions);
    if (report.status !== "passed") throw new Error("MAINTENANCE_ACTIVATION_NOT_ACCEPTED");
  };
}

// packages/cloud-deploy/src/cn-migration-completion-cli.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_child_process5 = require("node:child_process");
var import_node_path2 = require("node:path");
var import_node_crypto8 = require("node:crypto");
function readProtectedCompletionBytes(path2, mode = 384, fixture) {
  const uid = fixture?.uid ?? 0, gid = fixture?.gid ?? 0;
  for (let parent = (0, import_node_path2.dirname)(path2); ; parent = (0, import_node_path2.dirname)(parent)) {
    const st = import_node_fs4.default.lstatSync(parent);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || st.gid !== gid || st.mode & 18) throw new Error("MIGRATION_COMPLETION_INPUT_PARENT");
    if (parent === (fixture?.boundary ?? "/")) break;
  }
  const fd = import_node_fs4.default.openSync(path2, import_node_fs4.default.constants.O_RDONLY | import_node_fs4.default.constants.O_NOFOLLOW);
  try {
    const before = import_node_fs4.default.fstatSync(fd);
    if (!before.isFile() || before.uid !== uid || before.gid !== gid || before.nlink !== 1 || (before.mode & 511) !== mode || before.size > 32 * 1024 * 1024) throw new Error("MIGRATION_COMPLETION_INPUT_FILE");
    const raw = import_node_fs4.default.readFileSync(fd), after = import_node_fs4.default.fstatSync(fd), named = import_node_fs4.default.lstatSync(path2);
    if (!named.isFile() || named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== 1 || named.uid !== uid || named.gid !== gid || (named.mode & 511) !== mode) throw new Error("MIGRATION_COMPLETION_INPUT_CHANGED");
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("MIGRATION_COMPLETION_INPUT_CHANGED");
    return raw;
  } finally {
    import_node_fs4.default.closeSync(fd);
  }
}
function readProtectedCompletionInput(path2, fixture) {
  const raw = readProtectedCompletionBytes(path2, 384, fixture);
  return { raw, value: JSON.parse(raw.toString("utf8")) };
}
function verifyTrustedCompletionHelper() {
  const helper = "/usr/local/lib/workspacex-cn/cn-build-tool-identity.py";
  const profile = readProtectedCompletionInput("/etc/workspacex-cn/trusted-tool-binding.json").value;
  const raw = readProtectedCompletionBytes(helper, 448);
  if (!/^[a-f0-9]{40}$/.test(profile.toolRevision ?? "") || (0, import_node_crypto8.createHash)("sha256").update(raw).digest("hex") !== profile.filesSha256?.[".harness/scripts/vm/cn-build-tool-identity.py"]) throw new Error("MIGRATION_COMPLETION_HELPER_BINDING");
  return helper;
}
async function main(args = process.argv.slice(2)) {
  if (process.getuid?.() !== 0 || process.getgid?.() !== 0 || args.length !== 2 || !/^[a-f0-9]{40}$/.test(args[0]) || !/^[A-Za-z0-9-]{1,128}$/.test(args[1])) throw new Error("MIGRATION_COMPLETION_ROOT_ARGUMENTS");
  const [source2, attempt] = args;
  const input = readProtectedCompletionInput(`/etc/workspacex-cn/migration-completion-inputs/${source2}/${attempt}.completed.json`);
  const value = input.value;
  if (!value || value.schemaVersion !== 1 || value.kind !== "validated-migration-completion" || value.identity?.sourceRevision !== source2 || value.identity?.attemptId !== attempt || value.expected?.sourceRevision !== source2 || value.expected?.attemptId !== attempt) throw new Error("MIGRATION_COMPLETION_CLI_IDENTITY");
  const profile = readProtectedCompletionInput("/etc/workspacex-cn/trusted-tool-binding.json").value;
  if (value.toolRevision !== profile.toolRevision) throw new Error("MIGRATION_COMPLETION_RECEIPT_TOOL");
  const helper = verifyTrustedCompletionHelper();
  const checkout = (0, import_node_child_process5.execFileSync)("/usr/bin/python3", [helper, "--completion-checkout", source2, attempt], {
    encoding: "utf8",
    timeout: 6e4,
    maxBuffer: 4096,
    stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", 9],
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" }
  }).trim();
  if (checkout !== `/var/lib/workspacex-cn/releases/${source2}`) throw new Error("MIGRATION_COMPLETION_CHECKOUT_BINDING");
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
  Object.assign(process.env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: "/dev/null",
    GIT_CONFIG_KEY_2: "core.untrackedCache",
    GIT_CONFIG_VALUE_2: "false",
    GIT_CONFIG_KEY_3: "gc.auto",
    GIT_CONFIG_VALUE_3: "0"
  });
  const witness = await verifyMigrationCompletion(value.snapshotInput, value.bindingInput, checkout, value.expected);
  if (JSON.stringify(witness) !== JSON.stringify(value.witness)) throw new Error("MIGRATION_COMPLETION_RECEIPT_WITNESS");
  process.stdout.write(`CN_MIGRATION_COMPLETION_JSON=${JSON.stringify({ ...witness, protectedInputSha256: (0, import_node_crypto8.createHash)("sha256").update(input.raw).digest("hex") })}
`);
}
if (process.argv[1]?.endsWith("cn-migration-completion-cli.ts")) void main().catch(() => {
  process.stderr.write("CN_MIGRATION_COMPLETION_REJECTED\n");
  process.exitCode = 1;
});

// packages/cloud-deploy/src/cn-maintenance-host/migration_transport.ts
var hex = external_exports.string().regex(/^[a-f0-9]{64}$/);
var configSchema = external_exports.object({ host: external_exports.string().min(1).max(253), port: external_exports.number().int().min(1).max(65535), database: external_exports.literal("workspacex"), user: external_exports.string().min(1), password: external_exports.string().min(1), ssl: external_exports.union([external_exports.literal(false), external_exports.object({ rejectUnauthorized: external_exports.literal(true), ca: external_exports.string().min(1) }).strict()]), connectionTimeoutMillis: external_exports.number().int().min(1).max(3e5), statement_timeout: external_exports.number().int().min(1).max(3e5) }).strict();
var defaults2 = { read: readProtectedCompletionBytes, runBash: runFixedPython, runWriter: void 0, verifyExecutable: (command3) => {
  const fd = protectedExecutable(command3);
  (0, import_node_fs5.closeSync)(fd);
}, now: Date.now, verifyCompletion: verifyMigrationCompletion, persist: void 0 };
function verifyBaselineMigrationAdmission(raw, validatedRaw, id3, now) {
  const evidence = JSON.parse(raw.toString("utf8")), validated = JSON.parse(validatedRaw.toString("utf8"));
  const canonical3 = (v) => Array.isArray(v) ? "[" + v.map(canonical3).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical3(v[k])).join(",") + "}" : JSON.stringify(v);
  const hash10 = (0, import_node_crypto9.createHash)("sha256").update(canonical3(evidence)).digest("hex");
  const issued2 = Date.parse(evidence.issuedAt), expires = Date.parse(evidence.expiresAt);
  const b = evidence.checks?.["bootstrap.compatibility"];
  const proof = b?.metadata;
  if (evidence.schemaVersion !== 2 || evidence.phase !== "prebuild" || evidence.buildStarted !== false || evidence.sourceSha !== id3.sourceRevision || evidence.baselineSha !== id3.baselineRevision || evidence.attemptId !== id3.attemptId || !Number.isFinite(issued2) || !Number.isFinite(expires) || issued2 > now || expires <= now || expires - issued2 <= 0 || expires - issued2 > 36e5 || validated.schemaVersion !== 2 || validated.phase !== "prebuild" || validated.ready !== true || !Array.isArray(validated.blockers) || validated.blockers.length || validated.receiptSha256 !== hash10 || ["sourceSha", "baselineSha", "attemptId", "release", "issuedAt", "expiresAt"].some((k) => validated[k] !== evidence[k]) || b?.status !== "passed" || !hex.safeParse(b?.evidenceSha256).success || proof?.evidenceMode !== "source-static" || proof?.baselineSha !== id3.baselineRevision || proof?.migrationPlanSha256 !== id3.migrationPlanSha256 || !hex.safeParse(proof?.baselineSchemaSha256).success || proof?.baselineLedgerContract !== true || proof?.baselineSchemaContract !== true || proof?.baselinePermissionContract !== true || proof?.candidateSchemaContract !== false || proof?.buildAdmissionOnly !== true || proof?.productionWriteStatements !== 0) throw Error("MIGRATION_BASELINE_ADMISSION_INVALID");
}
function createMigrationTransport(inputs, binding2, runWriter, lifecycle, fixture, authority) {
  if (!lifecycle || typeof lifecycle.migrateExactPlan !== "function" || typeof lifecycle.readDiagnosticLedger !== "function" || typeof lifecycle.recordMigrationCompletion !== "function") throw new Error("PERSISTENT_MIGRATION_LIFECYCLE_REQUIRED");
  const runtime = { ...defaults2, runWriter, persist: async (path2, bytes) => {
    assertSourcePlanAuthority(authority, binding2.identity, binding2.toolRevision);
    await inheritedFd9Lock();
    publishMigrationReceipt(path2, bytes, void 0, authority);
  }, ...fixture };
  const id3 = binding2.identity;
  assertSourcePlanAuthority(authority, id3, binding2.toolRevision);
  const root = `/etc/workspacex-cn/maintenance-migration/${id3.sourceRevision}/${id3.attemptId}`;
  if (!/^[a-f0-9]{40}$/.test(id3.sourceRevision) || id3.baselineRevision !== "ba6343199f3c834d6a198f83d0c771614292c82b" || !/^[A-Za-z0-9-]{1,128}$/.test(id3.attemptId) || !hex.safeParse(id3.migrationPlanSha256).success || binding2.configPath !== root + "/config.json" || binding2.completionPath !== `/etc/workspacex-cn/migration-completion-inputs/${id3.sourceRevision}/${id3.attemptId}.json` || !/^[a-f0-9]{40}$/.test(binding2.toolRevision) || !hex.safeParse(binding2.configSha256).success || !hex.safeParse(binding2.writerPlanCanonicalSha256).success || binding2.collector.path !== "/usr/local/lib/workspacex-cn/collect-cn-migration-snapshot.py" || binding2.writerFence.path !== "/usr/local/lib/workspacex-cn/host_transport.py" || !Number.isSafeInteger(binding2.lockTimeoutMs) || binding2.lockTimeoutMs < 1 || binding2.lockTimeoutMs > 3e5) throw new Error("MIGRATION_HOST_BINDING_INVALID");
  const source2 = migrationSourceSchema.parse(inputs.expectedCompletion.productionSource);
  const ddlSource = migrationSourceSchema.parse(binding2.ddlSource);
  const ddlEvidence = sourceEvidenceSchema.parse(binding2.ddlSourceEvidence);
  if (!verifyExternalSourceIdentity(ddlSource, ddlEvidence) || ddlSource.user === source2.user || ["accountId", "regionId", "dbInstanceId", "database", "endpointSha256", "serverAddressSha256", "port", "identityLane", "clientPeerAddressSha256", "clientPeerPort", "sslMode", "clientEncrypted", "clientTlsAuthorized"].some((key) => ddlSource[key] !== source2[key])) throw new Error("MIGRATION_DDL_DIAGNOSTIC_TARGET_MISMATCH");
  let startedAt;
  let completed = false;
  const config = () => {
    const raw = runtime.read(binding2.configPath);
    if ((0, import_node_crypto9.createHash)("sha256").update(raw).digest("hex") !== binding2.configSha256) throw new Error("MIGRATION_CONFIG_HASH_CHANGED");
    const cfg = configSchema.parse(JSON.parse(raw.toString("utf8")));
    if (ddlSource.database !== cfg.database || ddlSource.user !== cfg.user || ddlSource.endpointSha256 !== identityHash(`${cfg.host}:${cfg.port}`)) throw new Error("MIGRATION_CONNECTION_IDENTITY_MISMATCH");
    const intended = JSON.parse(runtime.read(binding2.completionPath).toString("utf8"));
    const evidence = sourceEvidenceSchema.parse(intended.sourceEvidence);
    if (!verifyExternalSourceIdentity(source2, evidence)) throw new Error("MIGRATION_EXTERNAL_SOURCE_UNVERIFIED");
    if (ddlSource.sslMode === "verify-full") {
      if (cfg.ssl === false || !ddlSource.clientEncrypted || !ddlSource.clientTlsAuthorized) throw new Error("MIGRATION_CONNECTION_TLS_MISMATCH");
    } else {
      if (cfg.ssl !== false) throw new Error("MIGRATION_CONNECTION_TLS_MISMATCH");
      approveExistingNoTls(ddlSource, ddlEvidence, binding2.approvedRdsTlsException);
    }
    return { cfg, evidence };
  };
  const diagnostic = async () => {
    const report = await lifecycle.readDiagnosticLedger(id3);
    const connection = report.connection;
    const socket = connection?.socket;
    if (!connection || !socket || !Array.isArray(report.ledger) || report.rowCount !== report.ledger.length || new Set(report.ledger.map((row2) => row2.name)).size !== report.ledger.length) throw new Error("MIGRATION_DIAGNOSTIC_PROTOCOL");
    const intended = JSON.parse(runtime.read(binding2.completionPath).toString("utf8"));
    verifyMigrationPeer(source2, { database: connection.peer.database, user: connection.role, serverAddress: connection.peer.serverAddr, serverPort: connection.peer.serverPort, remoteAddress: socket.remoteAddress, remotePort: socket.remotePort, encrypted: socket.encrypted, authorized: socket.authorized, localAddress: socket.localAddress }, { sourceEvidence: intended.sourceEvidence, approvedRdsTlsException: binding2.approvedRdsTlsException });
    return report.ledger.map(({ name, checksum }) => ({ name, checksum })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  };
  const barrier = async () => {
    assertSourcePlanAuthority(authority, id3, binding2.toolRevision);
    const result = await runtime.runWriter(binding2.writerFence, ["--apply-reviewed-fence", binding2.writerPlanPath, binding2.writerPlanSha256, "verifyWritesBlocked"]);
    const fact = JSON.parse(result.stdout);
    const now = runtime.now() / 1e3;
    if (fact.schemaVersion !== 1 || fact.kind !== "maintenance-writers-held" || fact.ready !== false || !fact.identity || Object.entries(id3).some(([k, v]) => fact.identity[k] !== v) || Object.keys(fact.identity).length !== 4 || !hex.safeParse(fact.planSha256).success || fact.planSha256 !== binding2.writerPlanCanonicalSha256 || typeof fact.observedAt !== "number" || fact.observedAt > now || now - fact.observedAt > 30 || !hex.safeParse(fact.databaseSessionsSha256).success || !Array.isArray(fact.families) || fact.families.join(",") !== "http,socket,queue,background,agent,checkpoint,memory,privileged") throw new Error("MIGRATION_LIVE_WRITER_BARRIER_INVALID");
  };
  return {
    verifyLiveWriterBarrier: barrier,
    migrate: async () => {
      assertSourcePlanAuthority(authority, id3, binding2.toolRevision);
      if (startedAt !== void 0) throw new Error("MIGRATION_REENTRY_FORBIDDEN");
      runtime.verifyExecutable(binding2.collector);
      runtime.verifyExecutable(binding2.writerFence);
      const { cfg, evidence } = config();
      const preflight = JSON.parse((await runtime.runBash(binding2.collector, ["--preflight-completion", id3.sourceRevision, id3.attemptId, id3.migrationPlanSha256])).stdout);
      if (preflight.schemaVersion !== 1 || preflight.kind !== "migration-collector-preflight" || preflight.ready !== false || preflight.toolRevision !== binding2.toolRevision || !preflight.identity || Object.keys(preflight.identity).length !== 4 || Object.entries(id3).some(([k, v]) => preflight.identity[k] !== v) || !hex.safeParse(preflight.querySha256).success || preflight.querySha256 !== identityHash("/usr/bin/node /usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs --readonly-ledger " + id3.sourceRevision + " " + id3.attemptId + "\n")) throw new Error("MIGRATION_COLLECTOR_PREFLIGHT_FAILED");
      const before = await diagnostic();
      if (JSON.stringify(before) !== JSON.stringify(inputs.plan.ledger)) throw new Error("MIGRATION_DIAGNOSTIC_BASELINE_LEDGER_CHANGED");
      const admissionRoot = `/var/lib/workspacex-cn/preflight-receipts/${id3.sourceRevision}/${id3.attemptId}`;
      verifyBaselineMigrationAdmission(runtime.read(admissionRoot + "/prebuild.json"), runtime.read(admissionRoot + "/prebuild.validated.json"), id3, runtime.now());
      await barrier();
      startedAt = runtime.now();
      const result = await lifecycle.migrateExactPlan(id3);
      await barrier();
      completed = true;
      return result;
    },
    readFreshCompletion: async () => {
      if (!completed || startedAt === void 0) throw new Error("MIGRATION_COMPLETION_BEFORE_MIGRATION");
      await barrier();
      const liveLedger = await diagnostic();
      const result = await runtime.runBash(binding2.collector, ["--maintenance-completion", id3.sourceRevision, id3.attemptId, id3.migrationPlanSha256]);
      const value = JSON.parse(result.stdout);
      if (value.schemaVersion !== 1 || typeof value.providerResponseBase64 !== "string" || !hex.safeParse(value.providerResponseSha256).success) throw new Error("MIGRATION_PROVIDER_RESPONSE_INVALID");
      const raw = Buffer.from(value.providerResponseBase64, "base64");
      if (raw.toString("base64") !== value.providerResponseBase64 || (0, import_node_crypto9.createHash)("sha256").update(raw).digest("hex") !== value.providerResponseSha256) throw new Error("MIGRATION_PROVIDER_RESPONSE_INVALID");
      const actual2 = JSON.parse(raw.toString("utf8"));
      const finished = Date.parse(actual2.Invocation?.InvocationResults?.InvocationResult?.[0]?.FinishedTime);
      if (!Number.isFinite(finished) || finished < startedAt || finished > runtime.now()) throw new Error("MIGRATION_COMPLETION_NOT_FROM_THIS_EXECUTION");
      const intended = JSON.parse(runtime.read(binding2.completionPath).toString("utf8"));
      if (JSON.stringify(intended.expected) !== JSON.stringify(inputs.expectedCompletion)) throw new Error("MIGRATION_COMPLETION_EXPECTED_CHANGED");
      const snapshot2 = { schemaVersion: 2, kind: "cn-readonly-migration-snapshot", capturedAt: new Date(runtime.now()).toISOString(), source: source2, fullResponseBase64: value.providerResponseBase64, fullResponseSha256: value.providerResponseSha256 };
      const sourceBinding = { schemaVersion: 2, source: source2, sourceEvidence: intended.sourceEvidence, cloud: value.cloud };
      const validated = validateMigrationSnapshot(snapshot2, sourceBinding);
      if (JSON.stringify(validated.ledger) !== JSON.stringify(liveLedger)) throw new Error("MIGRATION_PROVIDER_DIAGNOSTIC_LEDGER_MISMATCH");
      await barrier();
      const witness = readNativeCompletion(await runtime.verifyCompletion(snapshot2, sourceBinding, inputs.checkout, inputs.expectedCompletion, new Date(runtime.now())), id3, runtime.now());
      const receiptPath = binding2.completionPath.replace(/\.json$/, ".completed.json");
      const bytes = Buffer.from(JSON.stringify(witness) + "\n");
      const receipt = { path: receiptPath, sha256: (0, import_node_crypto9.createHash)("sha256").update(bytes).digest("hex") };
      await lifecycle.recordMigrationCompletion(id3, "intent", receipt);
      await runtime.persist(receiptPath, bytes);
      await lifecycle.recordMigrationCompletion(id3, "durable", receipt);
      await barrier();
      return { snapshot: snapshot2, binding: sourceBinding };
    }
  };
}
function publishMigrationReceipt(path2, bytes, fixture, authority) {
  if (!fixture) {
    if (!authority) throw Error("ORIGINAL_PLAN_AUTHORITY_REQUIRED");
    assertSourcePlanAuthority(authority, authority.identity, authority.toolRevision);
    if (path2 !== `/etc/workspacex-cn/migration-completion-inputs/${authority.identity.sourceRevision}/${authority.identity.attemptId}.completed.json`) throw Error("MIGRATION_RECEIPT_AUTHORITY_PATH");
    readNativeCompletion(JSON.parse(bytes.toString("utf8")), authority.identity);
  }
  if (!fixture && !/^\/etc\/workspacex-cn\/migration-completion-inputs\/[a-f0-9]{40}\/[A-Za-z0-9-]{1,128}\.completed\.json$/.test(path2)) throw new Error("MIGRATION_RECEIPT_PATH");
  if (bytes.length > 8 * 1024 * 1024) throw new Error("MIGRATION_RECEIPT_BOUND");
  const uid = fixture?.uid ?? 0, gid = fixture?.gid ?? 0;
  const parent = (0, import_node_path3.dirname)(path2);
  for (let directory2 = parent; ; directory2 = (0, import_node_path3.dirname)(directory2)) {
    const info = (0, import_node_fs5.lstatSync)(directory2);
    if (!info.isDirectory() || info.uid !== uid || info.gid !== gid || info.mode & 18) throw new Error("MIGRATION_RECEIPT_PARENT");
    if (directory2 === (fixture?.boundary ?? "/")) break;
  }
  const directory = (0, import_node_fs5.openSync)(parent, import_node_fs5.constants.O_RDONLY | import_node_fs5.constants.O_DIRECTORY | import_node_fs5.constants.O_NOFOLLOW);
  const temporary = path2 + "." + process.pid + "." + (0, import_node_crypto10.randomUUID)() + ".tmp";
  let published = false;
  try {
    const fd = (0, import_node_fs5.openSync)(temporary, import_node_fs5.constants.O_WRONLY | import_node_fs5.constants.O_CREAT | import_node_fs5.constants.O_EXCL | import_node_fs5.constants.O_NOFOLLOW, 384);
    try {
      const st2 = (0, import_node_fs5.fstatSync)(fd);
      if (st2.uid !== uid || st2.gid !== gid || st2.nlink !== 1) throw new Error("MIGRATION_RECEIPT_OWNER");
      (0, import_node_fs5.writeFileSync)(fd, bytes);
      (0, import_node_fs5.fsyncSync)(fd);
    } finally {
      (0, import_node_fs5.closeSync)(fd);
    }
    (0, import_node_fs5.linkSync)(temporary, path2);
    published = true;
    (0, import_node_fs5.unlinkSync)(temporary);
    (0, import_node_fs5.fsyncSync)(directory);
    const st = (0, import_node_fs5.lstatSync)(path2);
    if (!st.isFile() || st.uid !== uid || st.gid !== gid || st.nlink !== 1 || (st.mode & 511) !== 384) throw new Error("MIGRATION_RECEIPT_READBACK");
  } catch (error) {
    if (!published) {
      try {
        (0, import_node_fs5.unlinkSync)(temporary);
      } catch {
      }
    }
    throw error;
  } finally {
    (0, import_node_fs5.closeSync)(directory);
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/activation_transport.ts
var import_node_crypto11 = require("node:crypto");
var hash5 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var identitySchema = external_exports.object({ sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), baselineRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), migrationPlanSha256: hash5, attemptId: external_exports.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict();
var receiptSchema = external_exports.object({
  prepared: preparedCnReleaseSchema.innerType(),
  maintenance: external_exports.object({
    identity: identitySchema,
    toolRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
    recoveryEvidenceSha256: hash5,
    objectRecoveryEvidenceSha256: hash5,
    writerPlanSha256: hash5,
    migrationCompletionSha256: hash5,
    authorization: external_exports.object({ identity: identitySchema, action: external_exports.literal("maintenance-destructive-activation"), notBefore: external_exports.string().datetime(), expiresAt: external_exports.string().datetime() }).strict()
  }).strict()
}).strict();
var equal2 = (a, b) => Object.keys(a).length === 4 && ["sourceRevision", "baselineRevision", "migrationPlanSha256", "attemptId"].every((k) => a[k] === b[k]);
function validateMaintenancePrepared(input, identity2, now = /* @__PURE__ */ new Date()) {
  const r = receiptSchema.parse(input), p = r.prepared, m = r.maintenance, a = m.authorization;
  if (!equal2(m.identity, identity2) || !equal2(a.identity, identity2) || p.sourceRevision !== identity2.sourceRevision || p.baselineSourceRevision !== identity2.baselineRevision || p.migrationPlanSha256 !== identity2.migrationPlanSha256 || p.checks.migrationAssessed.evidenceSha256 !== identity2.migrationPlanSha256) throw Error("MAINTENANCE_PREPARED_IDENTITY_MISMATCH");
  if (p.diff.migrationRisk !== "destructive" || p.diff.pendingMigrationCount < 1 || p.failures.length) throw Error("MAINTENANCE_RISK_ASSESSMENT_REQUIRED");
  const start = Date.parse(p.preparedAt), end = Date.parse(p.expiresAt), before = Date.parse(a.notBefore), expires = Date.parse(a.expiresAt);
  if (end <= start || end - start > 7 * 864e5 || now.getTime() < start || now.getTime() >= end || expires <= before || expires - before > 36e5 || now.getTime() < before || now.getTime() >= expires) throw Error("MAINTENANCE_AUTHORIZATION_EXPIRED");
  return r;
}
function maintenanceOfflinePreparedAction(input, bytes, verifyOfflineArtifacts) {
  return async (identity2) => {
    const { prepared: p } = validateMaintenancePrepared(input, identity2);
    const manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
    if (manifest.sourceRevision !== identity2.sourceRevision || (0, import_node_crypto11.createHash)("sha256").update(bytes).digest("hex") !== p.manifestSha256) throw Error("MAINTENANCE_MANIFEST_MISMATCH");
    for (const service of ["web", "api", "agent", "sandbox"]) if (manifest.images[service].image.split("@").at(-1) !== p.images[service]) throw Error("MAINTENANCE_IMAGE_MISMATCH");
    await verifyOfflineArtifacts();
  };
}
function maintenanceActivationAction(input, actions, now) {
  return async (identity2) => {
    assertMaintenanceActivationCapability();
    const { prepared: p } = validateMaintenancePrepared(input, identity2, now?.());
    if (await actions.readBaselineFingerprint() !== p.baselineSha256) throw Error("BASELINE_CAS_MISMATCH");
    const drain = await actions.drainRuns();
    if ([drain.queued, drain.running, drain.writebackPending].some((v) => !Number.isSafeInteger(v) || v !== 0)) throw Error("RUN_DRAIN_INCOMPLETE");
    let promotionAttempted = false;
    try {
      promotionAttempted = true;
      await actions.promotePreparedPointer();
      await actions.activateTraffic();
      const c = await actions.verifyCanonical();
      if (c.status !== "passed" || c.lockRetained !== true || c.passedStages !== 8) throw Error("MAINTENANCE_CANONICAL_REJECTED");
      const browser = await actions.runBrowserSmoke();
      if (!["login", "hello", "asr", "githubFeedbackRead", "skillTool", "pdfDownload"].every((k) => browser[k] === true)) throw Error("MAINTENANCE_BROWSER_REJECTED");
    } catch {
      if (promotionAttempted) {
        try {
          await actions.restoreBaseline();
          await actions.restorePointer();
        } catch {
          throw Error("MAINTENANCE_ROLLBACK_UNPROVEN");
        }
      }
      throw Error("MAINTENANCE_ACTIVATION_NOT_ACCEPTED");
    }
  };
}
function assertMaintenanceActivationCapability() {
  throw Error("MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED");
}
function fixedMaintenanceActivationActions(binding2, run = runFixedPython, recoverRetained) {
  const identity2 = identitySchema.parse(binding2.identity);
  if (!/^[a-f0-9]{40}$/.test(binding2.toolRevision) || binding2.activationCommand.path !== "/usr/local/lib/workspacex-cn/cn-maintenance-activation.py" || binding2.recoveryCommand.path !== "/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py") throw Error("MAINTENANCE_ACTIVATION_COMMAND_BINDING");
  for (const [plan, base, name] of [[binding2.plan, "maintenance-activation", "activation-plan.json"], [binding2.recoveryPlan, "maintenance-recovery", "recovery-plan.json"]]) if (plan.path !== `/etc/workspacex-cn/${base}/${identity2.sourceRevision}/${identity2.attemptId}/${name}` || !hash5.safeParse(plan.sha256).success) throw Error("MAINTENANCE_ACTIVATION_PLAN_BINDING");
  async function operation(action) {
    const raw = await run(binding2.activationCommand, ["--maintenance-activation-operation", binding2.plan.path, binding2.plan.sha256, action]);
    const r = external_exports.object({ schemaVersion: external_exports.literal(1), kind: external_exports.literal("maintenance-activation-operation"), identity: identitySchema, toolRevision: external_exports.string(), planSha256: hash5, action: external_exports.string(), writesHeld: external_exports.literal(true), result: external_exports.record(external_exports.unknown()) }).strict().parse(JSON.parse(raw.stdout));
    if (!equal2(r.identity, identity2) || r.toolRevision !== binding2.toolRevision || r.planSha256 !== binding2.plan.sha256 || r.action !== action) throw Error("MAINTENANCE_ACTIVATION_RESPONSE_BINDING");
    return r.result;
  }
  return {
    readBaselineFingerprint: async () => external_exports.object({ baselineSha256: hash5 }).strict().parse(await operation("read-baseline-fingerprint")).baselineSha256,
    drainRuns: async () => external_exports.object({ queued: external_exports.number().int().nonnegative(), running: external_exports.number().int().nonnegative(), writebackPending: external_exports.number().int().nonnegative() }).strict().parse(await operation("read-run-drain")),
    promotePreparedPointer: async () => {
      external_exports.object({ pointerPromoted: external_exports.literal(true) }).strict().parse(await operation("promote-prepared-pointer"));
    },
    activateTraffic: async () => {
      external_exports.object({ trafficActivated: external_exports.literal(true) }).strict().parse(await operation("activate-traffic"));
    },
    verifyCanonical: async () => external_exports.object({ status: external_exports.literal("passed"), lockRetained: external_exports.literal(true), passedStages: external_exports.literal(8) }).strict().parse(await operation("verify-canonical")),
    runBrowserSmoke: async () => external_exports.object({ login: external_exports.literal(true), hello: external_exports.literal(true), asr: external_exports.literal(true), githubFeedbackRead: external_exports.literal(true), skillTool: external_exports.literal(true), pdfDownload: external_exports.literal(true) }).strict().parse(await operation("browser-acceptance")),
    restoreBaseline: async () => {
      if (!recoverRetained) throw Error("PERSISTENT_RECOVERY_REQUIRED");
      const pin = external_exports.object({ recoveryPlanSha256: hash5 }).strict().parse(await operation("verify-recovery-plan"));
      if (pin.recoveryPlanSha256 !== binding2.recoveryPlan.sha256) throw Error("RECOVERY_PLAN_DRIFT");
      const r = external_exports.object({ schemaVersion: external_exports.literal(1), kind: external_exports.literal("production-recovery-completed"), identity: identitySchema, receiptSha256: hash5, writesHeld: external_exports.literal(true), ready: external_exports.literal(false) }).strict().parse(await recoverRetained(identity2, binding2.recoveryPlan));
      if (!equal2(r.identity, identity2)) throw Error("BASELINE_DATABASE_RECOVERY_IDENTITY");
      external_exports.object({ baselineRuntimeRecovered: external_exports.literal(true), databaseRecoveryReceiptSha256: hash5 }).strict().superRefine((v, c) => {
        if (v.databaseRecoveryReceiptSha256 !== r.receiptSha256) c.addIssue({ code: external_exports.ZodIssueCode.custom, message: "RECOVERY_RECEIPT_BINDING" });
      }).parse(await operation("restore-baseline-runtime"));
    },
    restorePointer: async () => {
      external_exports.object({ baselinePointerRestored: external_exports.literal(true) }).strict().parse(await operation("restore-baseline-pointer"));
    }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/recovery_audit.ts
function preholdRecoveryArtifactAudit(verifier, toolRevision, evidenceSha256, run) {
  if (verifier.path !== "/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py" || !/^[a-f0-9]{40}$/.test(toolRevision) || !/^[a-f0-9]{64}$/.test(evidenceSha256)) throw new Error("PREHOLD_AUDIT_BINDING_INVALID");
  return async (identity2) => {
    if (!/^[a-f0-9]{40}$/.test(identity2.sourceRevision) || !/^[A-Za-z0-9-]{1,128}$/.test(identity2.attemptId)) throw new Error("PREHOLD_AUDIT_IDENTITY_INVALID");
    const path2 = `/etc/workspacex-cn/maintenance-evidence/${identity2.sourceRevision}/${identity2.attemptId}/recovery.json`;
    const result = await run(verifier, ["--prehold-artifact-audit", path2]);
    let value;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      throw new Error("PREHOLD_AUDIT_RESPONSE_INVALID");
    }
    const same6 = value?.identity && Object.keys(value.identity).sort().join(",") === Object.keys(identity2).sort().join(",") && Object.entries(identity2).every(([key, expected]) => value.identity[key] === expected);
    if (!value || value.schemaVersion !== 1 || value.kind !== "maintenance-recovery-artifact-audit" || !same6 || value.toolRevision !== toolRevision || value.evidenceSha256 !== evidenceSha256 || value.localArtifactEquivalent !== true || !Array.isArray(value.threeDatabases) || [...value.threeDatabases].sort().join(",") !== "workspacex,workspacex_agent,workspacex_memory" || value.ready !== false || value.productionRecoveryVerified !== false) throw new Error("PREHOLD_AUDIT_RESPONSE_INVALID");
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts
function rejectLegacyHeldPreflight() {
  throw Error("MAINTENANCE_HELD_PREFLIGHT_CONSUMER_NOT_IMPLEMENTED");
}

// packages/cloud-deploy/src/cn-maintenance-host/dynamic_gate.ts
var COLLECTOR = "/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh";
var VERIFIER = "/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh";
function readProductionValidatedReceipt(identity2, release) {
  if (!/^[a-f0-9]{40}$/.test(identity2.sourceRevision) || !/^[a-zA-Z0-9-]{1,128}$/.test(identity2.attemptId)) throw new Error("DYNAMIC_IDENTITY_INVALID");
  const result = protectedPrivateJson(`/var/lib/workspacex-cn/preflight-receipts/${identity2.sourceRevision}/${identity2.attemptId}/preactivate.validated.json`);
  const now = Date.now();
  if (!result || result.schemaVersion !== 2 || result.phase !== "preactivate" || result.sourceSha !== identity2.sourceRevision || result.baselineSha !== identity2.baselineRevision || result.attemptId !== identity2.attemptId || result.release !== release || result.ready !== true || result.buildStarted !== true || !Array.isArray(result.blockers) || result.blockers.length !== 0 || !/^[a-f0-9]{64}$/.test(result.receiptSha256) || !Number.isFinite(Date.parse(result.issuedAt)) || Date.parse(result.issuedAt) > now || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= now) throw new Error("PROTECTED_PREACTIVATE_READBACK_INVALID");
  return Promise.resolve();
}
function productionDynamicActions(collector, verifier, release, runBash, readValidatedReceipt) {
  if (collector.path !== COLLECTOR || verifier.path !== VERIFIER) throw new Error("PREFLIGHT_COMMAND_AUTHORITY");
  if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$/.test(release)) throw new Error("RELEASE_INVALID");
  let collectedIdentity;
  return {
    verifyProductionDynamic: async (identity2) => {
      if (!/^[a-f0-9]{40}$/.test(identity2.sourceRevision) || !/^[a-zA-Z0-9-]{1,128}$/.test(identity2.attemptId)) throw new Error("DYNAMIC_IDENTITY_INVALID");
      rejectLegacyHeldPreflight();
    },
    verifyPreactivate: async (identity2) => {
      if (!collectedIdentity || JSON.stringify(collectedIdentity) !== JSON.stringify(identity2)) throw new Error("DYNAMIC_GATE_NOT_COLLECTED");
      await runBash(verifier, ["--maintenance", "preactivate", identity2.sourceRevision, release, identity2.attemptId]);
      await readValidatedReceipt(identity2, release);
    }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/offline_artifacts.ts
var import_node_crypto12 = require("node:crypto");
var import_node_fs6 = require("node:fs");
var import_node_child_process6 = require("node:child_process");
function localImageInspectionArgs(image) {
  if (!/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("OFFLINE_IMAGE_REFERENCE");
  return ["--config", "/etc/workspacex-cn/docker-offline", "--host", "unix:///run/docker.sock", "image", "inspect", image];
}
async function inspectLocalImage(runtime, image) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("ROOT_LINUX_REQUIRED");
  if (runtime.path !== "/usr/bin/docker" || !/^[a-f0-9]{64}$/.test(runtime.sha256) || !/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("OFFLINE_DOCKER_BINDING");
  for (const path2 of ["/usr", "/usr/bin", "/etc", "/etc/workspacex-cn", "/run"]) {
    const s = (0, import_node_fs6.lstatSync)(path2);
    if (!s.isDirectory() || s.uid !== 0 || s.gid !== 0 || s.mode & 18) throw new Error("OFFLINE_DOCKER_PARENT");
  }
  const config = (0, import_node_fs6.lstatSync)("/etc/workspacex-cn/docker-offline"), socket = (0, import_node_fs6.lstatSync)("/run/docker.sock");
  if (!config.isDirectory() || config.uid !== 0 || config.gid !== 0 || (config.mode & 511) !== 448 || (0, import_node_fs6.readdirSync)("/etc/workspacex-cn/docker-offline").length !== 0 || !socket.isSocket() || socket.uid !== 0) throw new Error("OFFLINE_LOCAL_DAEMON_BINDING");
  const before = (0, import_node_fs6.lstatSync)(runtime.path), fd = (0, import_node_fs6.openSync)(runtime.path, import_node_fs6.constants.O_RDONLY | import_node_fs6.constants.O_NOFOLLOW);
  try {
    const s = (0, import_node_fs6.fstatSync)(fd);
    if (!s.isFile() || s.uid !== 0 || s.gid !== 0 || s.nlink !== 1 || (s.mode & 511) !== 493 || s.dev !== before.dev || s.ino !== before.ino || (0, import_node_crypto12.createHash)("sha256").update((0, import_node_fs6.readFileSync)(fd)).digest("hex") !== runtime.sha256) throw new Error("OFFLINE_DOCKER_RUNTIME");
    return await new Promise((resolve2, reject3) => {
      const c = (0, import_node_child_process6.spawn)("/proc/self/fd/10", [...localImageInspectionArgs(image)], { shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", fd] });
      let output = "", bytes = 0, timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        c.kill("SIGKILL");
      }, 3e4);
      c.stdout.on("data", (b) => {
        bytes += b.length;
        if (bytes > 1048576) c.kill("SIGKILL");
        else output += b;
      });
      c.stderr.resume();
      c.on("error", () => {
        clearTimeout(timer);
        reject3(new Error("OFFLINE_DOCKER_SPAWN"));
      });
      c.on("close", (code) => {
        clearTimeout(timer);
        code === 0 && !timedOut && bytes <= 1048576 ? resolve2(output) : reject3(new Error("OFFLINE_DOCKER_INSPECT"));
      });
    });
  } finally {
    (0, import_node_fs6.closeSync)(fd);
  }
}
function verifyOfflineManifest(identity2, bytes, expectedSha256, runtime, inspect = inspectLocalImage) {
  return async () => {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || (0, import_node_crypto12.createHash)("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("OFFLINE_MANIFEST_HASH");
    const manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
    if (manifest.sourceRevision !== identity2.sourceRevision) throw new Error("OFFLINE_APPLICATION_IDENTITY");
    await verifyPrewarmedRelease(manifest, "starter", async (argv) => {
      if (argv.length !== 4 || argv[0] !== "docker" || argv[1] !== "image" || argv[2] !== "inspect" || !argv[3]) throw new Error("OFFLINE_INSPECT_ONLY");
      return inspect(runtime, argv[3]);
    });
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/source_production_consumers.ts
var import_node_fs7 = require("node:fs");
var import_node_crypto13 = require("node:crypto");

// packages/cloud-deploy/src/cn-maintenance-host/public_acceptance.ts
var hash6 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var identitySchema2 = external_exports.object({ sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), baselineRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), migrationPlanSha256: hash6, attemptId: external_exports.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict();
var browserSchema = external_exports.object({ login: external_exports.literal(true), hello: external_exports.literal(true), asr: external_exports.literal(true), githubFeedbackRead: external_exports.literal(true), skillTool: external_exports.literal(true), pdfDownload: external_exports.literal(true) }).strict();
var markerSchema = external_exports.object({ sourceRevision: external_exports.string(), deploymentMarker: external_exports.string().min(1), trustworthy: external_exports.literal(true) }).strict();
var observationSchema = external_exports.object({ identity: identitySchema2, deploymentMarker: external_exports.string(), holdPresent: external_exports.literal(false), queued: external_exports.number().int().nonnegative().safe(), running: external_exports.number().int().nonnegative().safe(), writebackPending: external_exports.number().int().nonnegative().safe(), failedOwnedRuns: external_exports.literal(0), unhealthyServices: external_exports.literal(0) }).strict();
function bindPublicAcceptance(binding2, transport) {
  const identity2 = Object.freeze(identitySchema2.parse(binding2.identity));
  const marker = binding2.deploymentMarker;
  if (typeof marker !== "string" || !marker || !Number.isSafeInteger(binding2.observationSamples) || binding2.observationSamples < 2 || binding2.observationSamples > 60 || !Number.isSafeInteger(binding2.maximumOutstandingRuns) || binding2.maximumOutstandingRuns < 0) throw Error("PUBLIC_ACCEPTANCE_POLICY_INVALID");
  const samples = binding2.observationSamples, maximum = binding2.maximumOutstandingRuns;
  for (const name of ["readPublicIdentity", "verifyCanonical", "runBrowserSmoke", "readObservation"]) if (typeof transport?.[name] !== "function") throw Error("PUBLIC_ACCEPTANCE_TRANSPORT_MISSING:" + name);
  const readIdentity = transport.readPublicIdentity.bind(transport), canonical3 = transport.verifyCanonical.bind(transport), browser = transport.runBrowserSmoke.bind(transport), observe = transport.readObservation.bind(transport);
  const same6 = (value) => JSON.stringify(identitySchema2.parse(value)) === JSON.stringify(identity2);
  async function readMarker() {
    const value = markerSchema.parse(await readIdentity());
    if (value.sourceRevision !== identity2.sourceRevision || value.deploymentMarker !== marker) throw Error("PUBLIC_ACCEPTANCE_IDENTITY_DRIFT");
  }
  return {
    verifyPublicAcceptance: async (value) => {
      if (!same6(value)) throw Error("PUBLIC_ACCEPTANCE_IDENTITY_CHANGED");
      await readMarker();
      external_exports.object({ status: external_exports.literal("passed"), lockRetained: external_exports.literal(true), passedStages: external_exports.literal(8) }).strict().parse(await canonical3());
      browserSchema.parse(await browser());
      await readMarker();
    },
    /** Invoke only after hold clear CAS and independent readback. Failure requires
     * re-hold/reconciliation; this consumer cannot restore baseline after SQL. */
    observeOpenedCandidate: async (value) => {
      if (!same6(value)) throw Error("PUBLIC_ACCEPTANCE_IDENTITY_CHANGED");
      for (let sample = 0; sample < samples; sample++) {
        await readMarker();
        const result = observationSchema.parse(await observe());
        if (!same6(result.identity) || result.deploymentMarker !== marker || result.queued + result.running + result.writebackPending > maximum) throw Error("OPENED_CANDIDATE_OBSERVATION_REJECTED");
      }
    }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/a_route_adapter.ts
var actionNames = [
  "acquireReleaseLock",
  "prepareOffline",
  "verifyPreholdRecoveryCapability",
  "verifyIsolatedCandidateAcceptance",
  "blockAllWrites",
  "verifyWritesBlocked",
  "captureAndVerifyCurrentEpochRecovery",
  "verifyCurrentEpochIsolatedCandidateAcceptance",
  "migrateExactPlan",
  "verifyHeldCandidateReadback",
  "stageCandidateRuntime",
  "verifyCandidateRuntimeIdentity",
  "persistCandidateResumeIntent",
  "resumeExactCandidateWriters",
  "verifyCandidateWritersResumed",
  "verifyPublicAcceptance",
  "observeOpenedCandidate",
  "blockCandidateWriters",
  "verifyNoMigrationCommitted",
  "resumeUnchangedBaselineCancellation",
  "verifyBaselineCancellation",
  "recordRecoveryRequired",
  "recordReconciliationRequired"
];
var same = (a, b) => !!a && typeof a === "object" && Object.keys(a).sort().join(",") === Object.keys(b).sort().join(",") && Object.entries(b).every(([k, v]) => a[k] === v);
function record2(value, identity2, state) {
  if (!value || value.schemaVersion !== 1 || value.state !== state || !same(value.identity, identity2) || !/^[a-f0-9]{32}$/.test(value.generation) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.device) || !Number.isSafeInteger(value.inode)) throw Error("A_ROUTE_HOLD_READBACK_INVALID");
  return value;
}
async function bindARouteHostOperations(input) {
  const { binding: binding2 } = input;
  const identity2 = Object.freeze({ ...binding2.identity });
  if (Object.keys(identity2).sort().join(",") !== "attemptId,baselineRevision,migrationPlanSha256,sourceRevision" || !/^[a-f0-9]{40}$/.test(identity2.sourceRevision) || !/^[a-f0-9]{40}$/.test(identity2.baselineRevision) || !/^[a-f0-9]{64}$/.test(identity2.migrationPlanSha256) || !/^[A-Za-z0-9-]{1,128}$/.test(identity2.attemptId)) throw Error("A_ROUTE_ADAPTER_IDENTITY_INVALID");
  if (typeof input.run !== "function" || typeof input.assertProtectedInputs !== "function" || !binding2.hold?.path.startsWith("/usr/local/lib/workspacex-cn/") || binding2.hold.path.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(binding2.hold.sha256)) throw Error("A_ROUTE_ADAPTER_TRANSPORT_INVALID");
  const command3 = Object.freeze({ ...binding2.hold });
  const run = input.run;
  const available = { ...input.actions, ...input.publicAcceptance ? bindPublicAcceptance(input.publicAcceptance.binding, input.publicAcceptance.transport) : {} };
  const missing = actionNames.filter((name) => typeof available[name] !== "function");
  if (missing.length) throw Error("A_ROUTE_HOST_CAPABILITY_MISSING:" + missing.sort().join(","));
  const actions = Object.fromEntries(actionNames.map((name) => [name, available[name].bind(available)]));
  await input.assertProtectedInputs();
  let originalHold;
  const check = (value) => {
    if (!same(value, identity2)) throw Error("A_ROUTE_ADAPTER_IDENTITY_CHANGED");
  };
  async function hold(action, data) {
    const response = await run(command3, [action, "/var/lib/workspacex-cn/runtime"], data);
    try {
      return JSON.parse(response.stdout);
    } catch {
      throw Error("A_ROUTE_HOLD_RESPONSE_INVALID");
    }
  }
  const result = Object.fromEntries(actionNames.map((name) => [name, async (value) => {
    check(value);
    return actions[name](identity2);
  }]));
  return {
    ...result,
    persistMaintenanceHold: async (value) => {
      check(value);
      originalHold = record2(await hold("create", identity2), identity2, "held");
    },
    verifyMaintenanceHoldPresent: async (value) => {
      check(value);
      const current = record2(await hold("read"), identity2, "held");
      if (originalHold && JSON.stringify(current) !== JSON.stringify(originalHold)) throw Error("A_ROUTE_HOLD_GENERATION_CHANGED");
      originalHold ??= current;
    },
    clearAndVerifyMaintenanceHold: async (value) => {
      check(value);
      if (!originalHold) throw Error("A_ROUTE_HOLD_CAS_INPUT_MISSING");
      const cleared = record2(await hold("clear", originalHold), identity2, "cleared");
      const current = record2(await hold("read"), identity2, "cleared");
      if (JSON.stringify(current) !== JSON.stringify(cleared)) throw Error("A_ROUTE_HOLD_CLEAR_READBACK_CHANGED");
      originalHold = void 0;
    }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/a_route_factory.ts
var hash7 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var identitySchema3 = external_exports.object({ sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), baselineRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), migrationPlanSha256: hash7, attemptId: external_exports.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict();
var refSchema = external_exports.object({ path: external_exports.string().startsWith("/etc/workspacex-cn/").refine((p) => !p.split("/").includes("..")), sha256: hash7 }).strict();
var methods = {
  offline: ["prepare"],
  prehold: ["verifyRecoveryCapability", "verifyIsolatedAcceptance"],
  epoch: ["captureAndVerify", "verifyCurrentEpochIsolatedAcceptance"],
  migration: ["migrateExactPlan"],
  heldReadback: ["verify"],
  candidate: ["stageAndSeal"],
  writer: [],
  public: [],
  disposition: ["recordRecoveryRequired", "recordReconciliationRequired"]
};
var epochSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  kind: external_exports.literal("held-current-epoch-evidence"),
  identity: identitySchema3,
  toolRevision: external_exports.string(),
  holdGeneration: external_exports.string().regex(/^[a-f0-9]{32}$/),
  epoch: refSchema,
  databases: external_exports.object({ workspacex: refSchema, workspacex_agent: refSchema, workspacex_memory: refSchema }).strict(),
  objectRecovery: refSchema,
  beforeHeldObservationSha256: hash7,
  afterHeldObservationSha256: hash7
}).strict();
var completionSchema = external_exports.object({ identity: identitySchema3, toolRevision: external_exports.string(), holdGeneration: external_exports.string(), epochSha256: hash7, completion: refSchema }).strict();
var candidateSchema = completionSchema.extend({ reference: refSchema }).strict();
var candidateEnvelopeSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  toolRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  plan: external_exports.object({ identity: identitySchema3, holdGeneration: external_exports.string().regex(/^[a-f0-9]{32}$/), epoch: hash7, migrationCompletionSha256: hash7, artifactSha256: hash7 }).passthrough(),
  artifact: refSchema
}).strict();
function frozen(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}
var same2 = (a, b) => runtimeDigest(a) === runtimeDigest(b);
function need2(value, code) {
  if (!value) throw Error(code);
}
function snapshot(consumer, names) {
  const value = { ...consumer, binding: frozen(structuredClone(consumer.binding)), assertCapability: consumer.assertCapability.bind(consumer) };
  for (const name of names) value[name] = consumer[name].bind(consumer);
  return value;
}
async function createARouteFactory(input) {
  const missing = [];
  for (const name of ["run", "acquireReleaseLock", "assertInstalledSource", "readEvidence"]) if (typeof input[name] !== "function") missing.push(name);
  for (const [group, names] of Object.entries(methods)) {
    const consumer = input.consumers?.[group];
    if (!consumer?.binding) missing.push(group + ".binding");
    for (const name of ["assertCapability", ...names]) if (typeof consumer?.[name] !== "function") missing.push(group + "." + name);
  }
  for (const name of ["start", "invoke", "bindCandidateReference", "candidateOperation", "baselineCancellation", "closeAfterAccepted", "retainUnknown"]) if (typeof input.consumers?.writer?.lifecycle?.[name] !== "function") missing.push("writer.lifecycle." + name);
  for (const name of ["readPublicIdentity", "verifyCanonical", "runBrowserSmoke", "readObservation"]) if (typeof input.consumers?.public?.transport?.[name] !== "function") missing.push("public.transport." + name);
  if (!input.consumers?.public?.bindingPolicy) missing.push("public.bindingPolicy");
  if (missing.length) throw Error("A_ROUTE_FACTORY_CONSUMERS_MISSING:" + missing.sort().join(","));
  const identity2 = Object.freeze(identitySchema3.parse(input.binding.identity));
  need2(/^[a-f0-9]{40}$/.test(input.toolRevision), "A_ROUTE_FACTORY_TOOL_REVISION");
  const toolRevision = input.toolRevision, run = input.run, acquire = input.acquireReleaseLock, assertSource = input.assertInstalledSource, readEvidence = input.readEvidence;
  const binding2 = { ...input.binding, identity: identity2, hold: Object.freeze({ ...input.binding.hold }) };
  const c = Object.fromEntries(Object.entries(methods).map(([group, names]) => [group, snapshot(input.consumers[group], names)]));
  const actor = input.consumers.writer.lifecycle;
  const lifecycle = Object.fromEntries(["start", "invoke", "bindCandidateReference", "candidateOperation", "baselineCancellation", "closeAfterAccepted", "retainUnknown"].map((name) => [name, actor[name].bind(actor)]));
  need2(same2(c.public.bindingPolicy.identity, identity2), "A_ROUTE_FACTORY_PUBLIC_IDENTITY");
  const acceptance = bindPublicAcceptance(structuredClone(c.public.bindingPolicy), c.public.transport);
  const commands = [binding2.hold];
  for (const consumer of Object.values(c)) {
    const b = consumer.binding;
    need2(same2(b.identity, identity2) && b.toolRevision === toolRevision, "A_ROUTE_FACTORY_CONSUMER_IDENTITY");
    need2(b.source?.path.startsWith("/usr/local/lib/workspacex-cn/") && !b.source.path.split("/").includes("..") && /^[a-f0-9]{64}$/.test(b.source.sha256), "A_ROUTE_FACTORY_SOURCE_BINDING");
    need2(Array.isArray(b.inputRefs) && b.inputRefs.length > 0, "A_ROUTE_FACTORY_SOURCE_INPUTS");
    b.inputRefs.forEach((ref4) => refSchema.parse(ref4));
    commands.push(b.source);
  }
  for (const command3 of commands) need2(input.installedFilesSha256?.[command3.path] === command3.sha256, "A_ROUTE_FACTORY_PROFILE_BINDING");
  let host, epoch, epochAccepted = false, completion;
  let candidate, resumeIntent = false, resumed = false, lockAcquired = false;
  const id3 = (value) => need2(same2(value, identity2), "A_ROUTE_FACTORY_IDENTITY_CHANGED");
  async function heldGeneration(state = "held") {
    const v = JSON.parse((await run(binding2.hold, ["read", "/var/lib/workspacex-cn/runtime"])).stdout);
    need2(v.schemaVersion === 1 && same2(v.identity, identity2) && v.state === state && /^[a-f0-9]{32}$/.test(v.generation), "A_ROUTE_FACTORY_HOLD_BINDING");
    return v.generation;
  }
  async function verifyBlocked(value) {
    id3(value);
    need2(host, "A_ROUTE_FACTORY_WRITER_NOT_STARTED");
    if (candidate) {
      await lifecycle.candidateOperation(identity2, "verify-blocked");
      await heldGeneration();
      return;
    }
    const v = JSON.parse((await lifecycle.invoke("verifyWritesBlocked", identity2)).stdout), generation = await heldGeneration();
    need2(v.schemaVersion === 1 && v.kind === "maintenance-writers-held" && v.ready === false && same2(v.identity, identity2) && v.holdGeneration === generation && v.planSha256 === host.writerPlanCanonicalSha256 && /^[a-f0-9]{64}$/.test(v.observationSha256) && Number.isFinite(v.observedAt) && Date.now() / 1e3 - v.observedAt >= 0 && Date.now() / 1e3 - v.observedAt <= 30, "A_ROUTE_FACTORY_HELD_OBSERVATION");
  }
  function migrationBinding(value) {
    need2(epoch && same2(value.identity, identity2) && value.toolRevision === toolRevision && value.holdGeneration === epoch.holdGeneration && value.epochSha256 === epoch.epoch.sha256, "A_ROUTE_FACTORY_MIGRATION_EPOCH");
    need2(value.completion.path === `/etc/workspacex-cn/migration-completion-inputs/${identity2.sourceRevision}/${identity2.attemptId}.completed.json`, "A_ROUTE_FACTORY_COMPLETION_PATH");
  }
  const actions = {
    acquireReleaseLock: async (value) => {
      id3(value);
      need2(!lockAcquired, "A_ROUTE_FACTORY_ATTEMPT_REUSE");
      const release = await acquire(identity2);
      lockAcquired = true;
      return async () => {
        if (host) await lifecycle.closeAfterAccepted();
        await release();
      };
    },
    prepareOffline: (value) => {
      id3(value);
      return c.offline.prepare(identity2);
    },
    verifyPreholdRecoveryCapability: (value) => {
      id3(value);
      return c.prehold.verifyRecoveryCapability(identity2);
    },
    verifyIsolatedCandidateAcceptance: (value) => {
      id3(value);
      return c.prehold.verifyIsolatedAcceptance(identity2);
    },
    blockAllWrites: async (value) => {
      id3(value);
      if (!host) host = await lifecycle.start();
      need2(same2(host.identity, identity2), "A_ROUTE_FACTORY_SEALED_HOST_IDENTITY");
      await lifecycle.invoke("blockAllWrites", identity2);
    },
    verifyWritesBlocked: verifyBlocked,
    captureAndVerifyCurrentEpochRecovery: async (value) => {
      id3(value);
      need2(host && !epoch, "A_ROUTE_FACTORY_EPOCH_REBIND");
      await verifyBlocked(identity2);
      const generation = await heldGeneration();
      const produced = epochSchema.parse(await c.epoch.captureAndVerify(identity2, host));
      need2(same2(produced.identity, identity2) && produced.toolRevision === toolRevision && produced.holdGeneration === generation, "A_ROUTE_FACTORY_EPOCH_IDENTITY");
      need2(produced.epoch.path === `/etc/workspacex-cn/maintenance-evidence/${identity2.sourceRevision}/${identity2.attemptId}/qualified-current-epoch/epoch.json`, "A_ROUTE_FACTORY_EPOCH_PATH");
      const raw = await readEvidence(produced.epoch);
      const { epoch: _ref, kind: _kind, ...contents } = produced;
      need2(same2(raw, { ...contents, kind: "held-current-epoch-manifest" }), "A_ROUTE_FACTORY_EPOCH_FILE_BINDING");
      await verifyBlocked(identity2);
      need2(await heldGeneration() === generation, "A_ROUTE_FACTORY_EPOCH_HOLD_DRIFT");
      epoch = frozen(structuredClone(produced));
    },
    verifyCurrentEpochIsolatedCandidateAcceptance: async (value) => {
      id3(value);
      need2(epoch, "A_ROUTE_FACTORY_EPOCH_MISSING");
      await c.epoch.verifyCurrentEpochIsolatedAcceptance(identity2, epoch);
      need2(await heldGeneration() === epoch.holdGeneration, "A_ROUTE_FACTORY_EPOCH_HOLD_DRIFT");
      epochAccepted = true;
    },
    migrateExactPlan: async (value) => {
      id3(value);
      need2(epoch && epochAccepted && !completion, "A_ROUTE_FACTORY_EPOCH_NOT_ACCEPTED");
      await verifyBlocked(identity2);
      const v = completionSchema.parse(await c.migration.migrateExactPlan(identity2, epoch));
      migrationBinding(v);
      const raw = await readEvidence(v.completion);
      readNativeCompletion(raw, identity2);
      completion = frozen(structuredClone(v));
    },
    verifyHeldCandidateReadback: async (value) => {
      id3(value);
      need2(epoch && completion, "A_ROUTE_FACTORY_COMPLETION_MISSING");
      await c.heldReadback.verify(identity2, epoch, completion);
      await verifyBlocked(identity2);
    },
    stageCandidateRuntime: async (value) => {
      id3(value);
      need2(host && epoch && completion && !candidate, "A_ROUTE_FACTORY_CANDIDATE_STAGE_ORDER");
      const v = candidateSchema.parse(await c.candidate.stageAndSeal(identity2, host, epoch, completion));
      migrationBinding(v);
      need2(same2(v.completion, completion.completion) && v.reference.path === `/etc/workspacex-cn/maintenance-candidate/${identity2.sourceRevision}/${identity2.attemptId}/candidate-plan.json`, "A_ROUTE_FACTORY_CANDIDATE_BINDING");
      const raw = candidateEnvelopeSchema.parse(await readEvidence(v.reference));
      need2(raw.toolRevision === toolRevision && same2(raw.plan.identity, identity2) && raw.plan.holdGeneration === epoch.holdGeneration && raw.plan.epoch === epoch.epoch.sha256 && raw.plan.migrationCompletionSha256 === completion.completion.sha256 && raw.artifact.sha256 === raw.plan.artifactSha256, "A_ROUTE_FACTORY_CANDIDATE_FILE_BINDING");
      await lifecycle.bindCandidateReference(identity2, v.reference);
      candidate = frozen(structuredClone(v));
    },
    verifyCandidateRuntimeIdentity: async (value) => {
      id3(value);
      need2(candidate, "A_ROUTE_FACTORY_CANDIDATE_UNBOUND");
      await lifecycle.candidateOperation(identity2, "verify-staging");
    },
    persistCandidateResumeIntent: async (value) => {
      id3(value);
      need2(candidate && !resumeIntent, "A_ROUTE_FACTORY_RESUME_INTENT_ORDER");
      await lifecycle.candidateOperation(identity2, "prepare-resume-intent");
      resumeIntent = true;
    },
    resumeExactCandidateWriters: async (value) => {
      id3(value);
      need2(candidate && resumeIntent, "A_ROUTE_FACTORY_RESUME_WITHOUT_INTENT");
      await lifecycle.candidateOperation(identity2, "resume");
    },
    verifyCandidateWritersResumed: async (value) => {
      id3(value);
      need2(candidate && resumeIntent, "A_ROUTE_FACTORY_RESUME_WITHOUT_INTENT");
      await lifecycle.candidateOperation(identity2, "verify-resumed");
      resumed = true;
    },
    verifyPublicAcceptance: async (value) => {
      id3(value);
      need2(resumed, "A_ROUTE_FACTORY_PUBLIC_BEFORE_RESUME");
      await acceptance.verifyPublicAcceptance(identity2);
    },
    observeOpenedCandidate: async (value) => {
      id3(value);
      need2(resumed && epoch, "A_ROUTE_FACTORY_PUBLIC_BEFORE_RESUME");
      need2(await heldGeneration("cleared") === epoch.holdGeneration, "A_ROUTE_FACTORY_OPEN_HOLD_DRIFT");
      await lifecycle.candidateOperation(identity2, "observe-opened");
      await acceptance.observeOpenedCandidate(identity2);
      await lifecycle.candidateOperation(identity2, "observe-opened");
    },
    blockCandidateWriters: async (value) => {
      id3(value);
      need2(candidate, "A_ROUTE_FACTORY_CANDIDATE_UNBOUND");
      await lifecycle.candidateOperation(identity2, "rebind-held-epoch-for-reblock");
      await lifecycle.candidateOperation(identity2, "block");
      await lifecycle.candidateOperation(identity2, "verify-blocked");
    },
    verifyNoMigrationCommitted: (value) => {
      id3(value);
      return lifecycle.baselineCancellation(identity2, "verify-no-migration");
    },
    resumeUnchangedBaselineCancellation: (value) => {
      id3(value);
      return lifecycle.baselineCancellation(identity2, "resume-baseline");
    },
    verifyBaselineCancellation: (value) => {
      id3(value);
      return lifecycle.baselineCancellation(identity2, "verify-baseline");
    },
    recordRecoveryRequired: async (value) => {
      id3(value);
      try {
        await c.disposition.recordRecoveryRequired(identity2);
      } finally {
        lifecycle.retainUnknown();
      }
    },
    recordReconciliationRequired: async (value) => {
      id3(value);
      try {
        await c.disposition.recordReconciliationRequired(identity2);
      } finally {
        lifecycle.retainUnknown();
      }
    }
  };
  return bindARouteHostOperations({ binding: binding2, actions, run, assertProtectedInputs: async () => {
    for (const command3 of commands) await assertSource(command3);
    for (const consumer of Object.values(c)) await consumer.assertCapability(consumer.binding);
  } });
}

// packages/cloud-deploy/src/cn-maintenance-host/current_epoch_manifest_consumer.ts
var digest2 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var ref = external_exports.object({ path: external_exports.string().startsWith("/etc/workspacex-cn/").refine((p) => !p.split("/").includes("..")), sha256: digest2 }).strict();
var identity = external_exports.object({ sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), baselineRevision: external_exports.literal("ba6343199f3c834d6a198f83d0c771614292c82b"), migrationPlanSha256: digest2, attemptId: external_exports.string().regex(/^[A-Za-z0-9-]{1,32}$/) }).strict();
var binding = external_exports.object({ identity, toolRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), host: external_exports.object({ instanceId: external_exports.string().min(1), bootId: external_exports.string().uuid() }).strict(), epoch: digest2, holdGeneration: external_exports.string().regex(/^[a-f0-9]{32}$/), targetInstanceId: external_exports.string().regex(/^pgm-[a-z0-9]+$/) }).strict();
var collection = binding.omit({ targetInstanceId: true }).extend({ schemaVersion: external_exports.literal(1), kind: external_exports.literal("current-held-epoch-evidence-collection"), sourceRdsInstanceId: external_exports.literal("pgm-uf6rg214cp381l49"), isolatedTargetInstanceId: external_exports.string(), evidenceRefs: external_exports.record(external_exports.string(), ref.or(ref.extend({ bytes: external_exports.number().int().positive() }).strict())), collectionVerified: external_exports.literal(true), ready: external_exports.literal(false), qualified: external_exports.literal(false), prepared: external_exports.literal(false), remainingTransport: external_exports.literal("retained-scoped-backup-transport-required") }).strict();
var need3 = (v, c) => {
  if (!v) throw new Error(c);
};
var CURRENT_EPOCH_PYTHON_MODULES = Object.freeze({ epoch_recovery: "cn-maintenance-recovery-evidence-verifier", writer_fence: "writer_fence", cn_backup_package: "cn_backup_package", cn_backup_sql: "cn_backup_sql", cn_production_recovery_executor: "cn_production_recovery_executor", current_held_epoch_evidence_producer: "current_held_epoch_evidence_producer", isolated_canonical_plan_factory: "isolated_canonical_plan_factory", isolated_conservation_evidence_producer: "isolated_conservation_evidence_producer", isolated_conservation_inputs: "isolated_conservation_inputs", isolated_conservation_plan: "isolated_conservation_plan", isolated_conservation_stage: "isolated_conservation_stage", isolated_rehearsal: "isolated_rehearsal" });
var epochEvidence = external_exports.object({ schemaVersion: external_exports.literal(1), kind: external_exports.literal("held-current-epoch-evidence"), identity, toolRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), holdGeneration: external_exports.string().regex(/^[a-f0-9]{32}$/), epoch: ref, databases: external_exports.object({ workspacex: ref, workspacex_agent: ref, workspacex_memory: ref }).strict(), objectRecovery: ref, beforeHeldObservationSha256: digest2, afterHeldObservationSha256: digest2 }).strict();
async function consumePreholdEpochManifest(policy, io = {}, authority) {
  return consumeQualifiedEpoch(policy, io, "--verify-prehold-epoch", authority);
}
async function consumeQualifiedEpoch(policy, io, operation, authority) {
  const b = binding.parse(policy.binding);
  const admit = () => operation === "--verify-prehold-epoch" ? assertPreholdArchiveAuthority(authority, policy) : assertSourcePlanAuthority(authority, b.identity, b.toolRevision);
  admit();
  const inputRef = ref.parse(policy.input), sourcePolicy = ref.parse(policy.sourcePolicy);
  const modules = policy.qualificationExecutable.pythonModules;
  need3(modules && Object.keys(modules).sort().join(",") === Object.keys(CURRENT_EPOCH_PYTHON_MODULES).sort().join(","), "EPOCH_QUALIFICATION_MODULE_CLOSURE");
  for (const [name, file] of Object.entries(CURRENT_EPOCH_PYTHON_MODULES)) {
    const module2 = modules[name];
    need3(module2 && module2.path === `/usr/local/lib/workspacex-cn/${file}.py` && digest2.safeParse(module2.sha256).success && policy.filesSha256[`.harness/scripts/vm/${file}.py`] === module2.sha256, "EPOCH_QUALIFICATION_MODULE_BINDING");
  }
  const command3 = Object.freeze({ ...policy.qualificationExecutable, pythonModules: Object.freeze(Object.fromEntries(Object.entries(modules).map(([name, module2]) => [name, Object.freeze({ ...module2 })]))) });
  const source2 = ".harness/scripts/vm/current_epoch_qualification.py";
  need3(command3.path === "/usr/local/lib/workspacex-cn/current_epoch_qualification.py" && digest2.safeParse(command3.sha256).success && policy.filesSha256[source2] === command3.sha256 && !command3.writerFenceModule, "EPOCH_QUALIFICATION_SOURCE_BINDING");
  const root = `/etc/workspacex-cn/maintenance-evidence/${b.identity.sourceRevision}/${b.identity.attemptId}`;
  need3(inputRef.path === root + "/qualification-input.json" && policy.outputRoot === root + "/qualified-current-epoch" && sourcePolicy.path.startsWith(root + "/"), "EPOCH_QUALIFICATION_FIXED_PATHS");
  const read = io.read ?? (async (r) => protectedPrivateJson(r.path, r.sha256));
  const input = await read(inputRef);
  need3(input?.schemaVersion === 2 && input.kind === "current-held-epoch-qualification" && input.outputRoot === policy.outputRoot, "EPOCH_QUALIFICATION_INPUT_SCHEMA");
  const candidate = input.binding;
  need3(candidate && runtimeDigest(Object.fromEntries(Object.keys(b).map((k) => [k, candidate[k]]))) === runtimeDigest(b) && digest2.safeParse(candidate.providerBindingSha256).success, "EPOCH_QUALIFICATION_INPUT_BINDING");
  const rawRef = input.sourcePolicy;
  need3(rawRef && rawRef.path === sourcePolicy.path && rawRef.sha256 === sourcePolicy.sha256, "EPOCH_QUALIFICATION_EXTERNAL_POLICY");
  await read(sourcePolicy);
  admit();
  const response = await (io.run ?? runFixedPython)(command3, [operation, inputRef.path]);
  let parsed;
  try {
    parsed = JSON.parse(response.stdout);
  } catch {
    throw Error("EPOCH_QUALIFICATION_OUTPUT_JSON");
  }
  const evidence = epochEvidence.parse(parsed);
  need3(runtimeDigest(evidence.identity) === runtimeDigest(b.identity) && evidence.toolRevision === b.toolRevision && evidence.holdGeneration === b.holdGeneration && evidence.epoch.path === policy.outputRoot + "/epoch.json", "EPOCH_QUALIFICATION_OUTPUT_BINDING");
  const { epoch, ...manifest } = evidence;
  need3(runtimeDigest(await read(epoch)) === runtimeDigest({ ...manifest, kind: "held-current-epoch-manifest" }), "EPOCH_QUALIFICATION_MANIFEST_RAW_BINDING");
  for (const [db, r] of Object.entries(evidence.databases)) {
    need3(r.path === policy.outputRoot + "/" + db + ".json", "EPOCH_QUALIFICATION_DATABASE_PATH");
    const persisted = await read(r);
    need3(persisted?.schemaVersion === 2 && persisted.kind === "qualified-held-database-evidence" && runtimeDigest(persisted.binding) === runtimeDigest(candidate), "EPOCH_QUALIFICATION_DATABASE_BINDING");
  }
  need3(evidence.objectRecovery.path === policy.outputRoot + "/objects.json", "EPOCH_QUALIFICATION_OBJECT_PATH");
  const objects = await read(evidence.objectRecovery);
  need3(objects?.schemaVersion === 2 && objects.kind === "qualified-held-object-recovery" && runtimeDigest(objects.binding) === runtimeDigest(candidate), "EPOCH_QUALIFICATION_OBJECT_BINDING");
  await read(inputRef);
  await read(sourcePolicy);
  return evidence;
}

// packages/cloud-deploy/src/cn-maintenance-host/source_production_consumers.ts
var hash8 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var ref2 = external_exports.object({ path: external_exports.string().startsWith("/etc/workspacex-cn/").refine((v) => !v.split("/").includes("..")), sha256: hash8 }).strict();
var command = external_exports.object({ path: external_exports.string().startsWith("/usr/local/lib/workspacex-cn/"), sha256: hash8 }).strict();
var schema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  identity: external_exports.object({ sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/), baselineRevision: external_exports.literal("ba6343199f3c834d6a198f83d0c771614292c82b"), migrationPlanSha256: hash8, attemptId: external_exports.string().regex(/^[A-Za-z0-9-]{1,32}$/) }).strict(),
  toolRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  prepared: external_exports.object({ receipt: ref2, manifest: ref2 }).strict(),
  migration: external_exports.object({ inputs: ref2, binding: external_exports.unknown() }).strict(),
  writerModules: external_exports.object({ writer_fence: command, fixed_probes: command, control_connection: command }).strict(),
  candidateModules: external_exports.object({ candidate_writer: command, candidate_backend_collector: command, candidate_host_transport: command }).strict(),
  sourceOperationModules: external_exports.record(command),
  prehold: external_exports.unknown(),
  dockerRuntime: external_exports.object({ path: external_exports.literal("/usr/bin/docker"), sha256: hash8 }).strict(),
  publicPolicy: external_exports.object({ deploymentMarker: external_exports.string().min(1), observationSamples: external_exports.number().int().min(2).max(60), maximumOutstandingRuns: external_exports.number().int().nonnegative().safe() }).strict()
}).strict();
var need4 = (ok, code) => {
  if (!ok) throw Error(code);
};
var same3 = (a, b) => runtimeDigest(a) === runtimeDigest(b);
var actual = {
  readJson: protectedPrivateJson,
  readBytes: protectedPrivateBytes,
  verifyExecutable: (c) => {
    const fd = protectedExecutable(c);
    (0, import_node_fs7.closeSync)(fd);
  },
  lifecycle: createPersistentWriterLifecycle,
  migration: createMigrationTransport,
  run: runFixedPython,
  acquireLock: inheritedFd9Lock
};
async function createSourceProductionConsumers(plan, profile, value, fixture = {}) {
  const io = { ...actual, ...fixture }, v = schema.parse(value), identity2 = plan.identity, toolRevision = v.toolRevision;
  need4(same3(v.identity, identity2) && toolRevision === plan.production.toolRevision && profile.toolRevision === toolRevision, "SOURCE_CONSUMER_IDENTITY");
  need4(Object.keys(v.sourceOperationModules).sort().join(",") === Object.keys(persistentSourceModules).sort().join(","), "SOURCE_CONSUMER_MODULE_CLOSURE");
  const verify = (c) => {
    need4(profile.installedFilesSha256?.[c.path] === c.sha256, "SOURCE_CONSUMER_PROFILE_PIN");
    io.verifyExecutable(c);
  };
  const all = [plan.host.hold, plan.host.writerFence, ...Object.values(v.writerModules), ...Object.values(v.candidateModules), ...Object.values(v.sourceOperationModules)];
  for (const [name, file] of Object.entries(persistentSourceModules)) {
    const c = v.sourceOperationModules[name];
    need4(c.path === `/usr/local/lib/workspacex-cn/${file}` && profile.filesSha256?.[`.harness/scripts/vm/${file}`] === c.sha256, "SOURCE_CONSUMER_SOURCE_CLOSURE");
  }
  for (const [name, c] of Object.entries({ ...v.writerModules, ...v.candidateModules })) need4(c.path === `/usr/local/lib/workspacex-cn/${name}.py`, "SOURCE_CONSUMER_MODULE_PATH");
  for (const c of all) verify(c);
  const capability = profile.maintenanceSourceOperations;
  need4(capability?.schemaVersion === 1 && capability.sourcePath === ".harness/scripts/vm/maintenance_source_operations.py" && capability.sha256 === v.sourceOperationModules.maintenance_source_operations.sha256 && capability.inputs && typeof capability.inputs === "object" && !Array.isArray(capability.inputs), "SOURCE_OPERATION_CAPABILITY");
  need4(profile.parentCaptureInvocation?.schemaVersion === 1 && typeof profile.parentCaptureInvocation.producerId === "string" && profile.parentCaptureInvocation.executablePins, "SOURCE_CAPTURE_CAPABILITY");
  need4(profile.currentEpochQualification?.schemaVersion === 2 && profile.currentEpochQualification.sourcePath === ".harness/scripts/vm/current_epoch_qualification.py" && profile.currentEpochQualification.sha256 === v.sourceOperationModules.current_epoch_qualification.sha256, "SOURCE_QUALIFICATION_CAPABILITY");
  const prehold = v.prehold;
  need4(prehold && same3(prehold.filesSha256, profile.filesSha256), "SOURCE_PREHOLD_SOURCE_POLICY");
  const migrationInputs = io.readJson(v.migration.inputs.path, v.migration.inputs.sha256);
  const migrationBinding = v.migration.binding;
  need4(same3(migrationBinding?.identity, identity2) && migrationBinding.toolRevision === toolRevision, "SOURCE_MIGRATION_BINDING");
  verify(migrationBinding.collector);
  const authority = readOriginalPlanAuthority(plan.host, toolRevision, profile, io.readBytes);
  const sourcePlan = authority.sourcePlan;
  const lifecycle = io.lifecycle({ identity: identity2, toolRevision, sourcePlanPath: plan.host.writerPlanPath, sourcePlanSha256: plan.host.writerPlanSha256, sourcePlan, host: plan.host, modules: v.writerModules, candidate: { modules: v.candidateModules }, sourceOperationModules: v.sourceOperationModules });
  const boundMigration = { ...migrationBinding };
  let heldHost;
  const start = lifecycle.start.bind(lifecycle);
  lifecycle.start = async () => {
    heldHost = await start();
    Object.assign(boundMigration, { writerPlanPath: heldHost.writerPlanPath, writerPlanSha256: heldHost.writerPlanSha256, writerPlanCanonicalSha256: heldHost.writerPlanCanonicalSha256 });
    return heldHost;
  };
  const runWriter = async (c, args, input) => {
    if (c.path !== plan.host.writerFence.path) return io.run(c, args, input);
    need4(heldHost && args.length === 4 && args[0] === "--apply-reviewed-fence" && args[1] === heldHost.writerPlanPath && args[2] === heldHost.writerPlanSha256 && args[3] === "verifyWritesBlocked", "SOURCE_PERSISTENT_WRITER_ROUTING");
    return lifecycle.invoke("verifyWritesBlocked", identity2);
  };
  const transport = io.migration(migrationInputs, boundMigration, runWriter, { migrateExactPlan: (id3) => lifecycle.migrateExactPlan(id3), readDiagnosticLedger: (id3) => lifecycle.readDiagnosticLedger(id3), recordMigrationCompletion: (id3, stage, receipt) => lifecycle.recordMigrationCompletion(id3, stage, receipt) }, void 0, authority);
  const operationSource = v.sourceOperationModules.maintenance_source_operations;
  const op = async (action) => {
    assertSourcePlanAuthority(authority, identity2, toolRevision);
    const live = io.readJson("/etc/workspacex-cn/trusted-tool-binding.json");
    need4(live.toolRevision === toolRevision && same3(live.filesSha256, profile.filesSha256) && same3(live.installedFilesSha256, profile.installedFilesSha256), "SOURCE_OPERATION_AUTHORITY_CHANGED");
    const r = ref2.parse(live.maintenanceSourceOperations?.inputs?.[action]);
    return lifecycle.sourceOperation(identity2, action, r);
  };
  const common = (source2) => ({ binding: { identity: identity2, toolRevision, source: source2, inputRefs: [{ path: plan.consumerInputsPath, sha256: plan.consumerInputsSha256 }] }, assertCapability: async () => {
    all.forEach(verify);
  } });
  let archived, current;
  const manifest = io.readBytes(v.prepared.manifest.path, v.prepared.manifest.sha256);
  const offline = maintenanceOfflinePreparedAction(io.readJson(v.prepared.receipt.path, v.prepared.receipt.sha256), manifest, verifyOfflineManifest(identity2, manifest, v.prepared.manifest.sha256, v.dockerRuntime));
  const readReceipt = (value2, lane) => {
    const r = ref2.parse(value2.receipt);
    need4(r.path === `/etc/workspacex-cn/maintenance-acceptance/${identity2.sourceRevision}/${identity2.attemptId}/${lane}.json`, "SOURCE_ACCEPTANCE_RECEIPT_PATH");
    const receipt = io.readJson(r.path, r.sha256);
    need4(receipt?.schemaVersion === 1 && receipt.kind === lane + "-acceptance-completed" && same3(receipt.identity, identity2) && receipt.deploymentMarker === v.publicPolicy.deploymentMarker, "SOURCE_ACCEPTANCE_RECEIPT_BINDING");
    return receipt.checks;
  };
  try {
    const route = await createARouteFactory({
      binding: plan.host,
      toolRevision,
      installedFilesSha256: profile.installedFilesSha256,
      run: io.run,
      acquireReleaseLock: async () => {
        const release = await io.acquireLock();
        return async () => {
          await release();
        };
      },
      assertInstalledSource: async (c) => verify(c),
      readEvidence: async (r) => io.readJson(r.path, r.sha256),
      consumers: {
        offline: { ...common(operationSource), prepare: offline },
        prehold: { ...common(prehold.qualificationExecutable), verifyRecoveryCapability: async () => {
          archived = await consumePreholdEpochManifest(prehold, { read: async (r) => io.readJson(r.path, r.sha256), run: io.run }, authority);
        }, verifyIsolatedAcceptance: async () => {
          need4(archived, "SOURCE_PREHOLD_NOT_VERIFIED");
          await consumePreholdEpochManifest(prehold, { read: async (r) => io.readJson(r.path, r.sha256), run: io.run }, authority);
        } },
        epoch: { ...common(operationSource), captureAndVerify: async () => {
          await op("capture-current-epoch-draft");
          await op("stage-epoch-external-evidence");
          await op("finalize-epoch-input");
          current = await op("qualify-current-epoch");
          return current;
        }, verifyCurrentEpochIsolatedAcceptance: async (_id, e) => {
          need4(same3(await op("verify-qualified-current-epoch"), e), "SOURCE_CURRENT_EPOCH_RECHECK");
        } },
        migration: { ...common(migrationBinding.collector), migrateExactPlan: async (id3, e) => {
          await exactMigrationAction(migrationInputs, transport)(id3);
          const path2 = boundMigration.completionPath.replace(/\.json$/, ".completed.json");
          const bytes = io.readBytes(path2);
          readNativeCompletion(JSON.parse(bytes.toString("utf8")), id3);
          return { identity: identity2, toolRevision, holdGeneration: e.holdGeneration, epochSha256: e.epoch.sha256, completion: { path: path2, sha256: (0, import_node_crypto13.createHash)("sha256").update(bytes).digest("hex") } };
        } },
        heldReadback: { ...common(operationSource), verify: async () => {
          await op("held-candidate-readback");
        } },
        candidate: { ...common(operationSource), stageAndSeal: async (_id, _host, e, c) => {
          const result = await op("stage-candidate-and-seal");
          return { ...c, reference: ref2.parse(result.reference) };
        } },
        writer: { ...common(plan.host.writerFence), lifecycle },
        public: { ...common(operationSource), bindingPolicy: { identity: identity2, ...v.publicPolicy }, transport: { readPublicIdentity: () => op("read-public-candidate-identity"), verifyCanonical: async () => readReceipt(await op("canonical-candidate-acceptance"), "canonical"), runBrowserSmoke: async () => readReceipt(await op("browser-candidate-acceptance"), "browser"), readObservation: () => op("observe-opened-candidate") } },
        disposition: { ...common(plan.host.writerFence), recordRecoveryRequired: async (id3) => {
          await lifecycle.invoke("recordDatabaseRecoveryRequired", id3);
        }, recordReconciliationRequired: async (id3) => {
          await lifecycle.invoke("recordWriteStateReconciliationRequired", id3);
        } }
      }
    });
    const inputs = { admittedARoute: route, assertProtectedInputs: async () => {
      all.forEach(verify);
    } };
    return { host: plan.host, inputs, run: runWriter, acquireLock: io.acquireLock, retainUnknown: () => lifecycle.retainUnknown() };
  } catch (error) {
    lifecycle.retainUnknown();
    throw error;
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/production_consumers.ts
var hash9 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var path = external_exports.string().startsWith("/etc/workspacex-cn/").refine((v) => !v.split("/").includes(".."));
var ref3 = external_exports.object({ path, sha256: hash9 }).strict();
var command2 = external_exports.object({ path: external_exports.string().startsWith("/usr/local/lib/workspacex-cn/"), sha256: hash9 }).strict();
var schema2 = external_exports.object({ schemaVersion: external_exports.literal(1), identity: external_exports.object({ sourceRevision: external_exports.string(), baselineRevision: external_exports.string(), migrationPlanSha256: hash9, attemptId: external_exports.string() }).strict(), toolRevision: external_exports.string(), prepared: external_exports.object({ receipt: ref3, manifest: ref3 }).strict(), migration: external_exports.object({ inputs: ref3, binding: external_exports.unknown() }).strict(), activation: external_exports.unknown(), recoveryAudit: external_exports.object({ verifier: command2, evidenceSha256: hash9 }).strict(), dockerRuntime: external_exports.object({ path: external_exports.literal("/usr/bin/docker"), sha256: hash9 }).strict(), dynamic: external_exports.object({ collector: command2, verifier: command2, release: external_exports.string() }).strict(), writerModules: external_exports.object({ writer_fence: command2, fixed_probes: command2, control_connection: command2 }).strict() }).strict();
function same4(a, b) {
  return runtimeDigest(a) === runtimeDigest(b);
}
var actualRuntime = { assertActivationCapability: assertMaintenanceActivationCapability, acquireLock: inheritedFd9Lock, readJson: protectedPrivateJson, readBytes: protectedPrivateBytes, verifyExecutable: (c) => {
  const fd = protectedExecutable(c);
  (0, import_node_fs8.closeSync)(fd);
}, lifecycle: createPersistentWriterLifecycle, migration: createMigrationTransport, activation: fixedMaintenanceActivationActions };
async function createProductionConsumers(plan, profile, fixture) {
  const io = { ...actualRuntime, ...fixture };
  const raw = io.readJson(plan.consumerInputsPath, plan.consumerInputsSha256);
  if (raw?.schemaVersion === 2) return createSourceProductionConsumers(plan, profile, raw, { readJson: io.readJson, readBytes: io.readBytes, verifyExecutable: io.verifyExecutable, lifecycle: io.lifecycle, migration: io.migration, acquireLock: io.acquireLock });
  const v = schema2.parse(raw);
  if (!same4(v.identity, plan.identity) || v.toolRevision !== plan.production.toolRevision) throw Error("CONSUMER_INPUT_IDENTITY");
  io.assertActivationCapability();
  const verify = (c) => {
    if (profile.installedFilesSha256?.[c.path] !== c.sha256) throw Error("CONSUMER_PROFILE_BINDING");
    io.verifyExecutable(c);
  };
  const migrationInputs = io.readJson(v.migration.inputs.path, v.migration.inputs.sha256);
  const migrationBinding = v.migration.binding;
  const activationBinding = v.activation;
  if (!same4(migrationBinding?.identity, plan.identity) || !same4(activationBinding?.identity, plan.identity) || activationBinding.toolRevision !== v.toolRevision) throw Error("CONSUMER_OPERATION_IDENTITY");
  const sourcePlan = io.readJson(plan.host.writerPlanPath, plan.host.writerPlanSha256);
  const lifecycle = io.lifecycle({ identity: plan.identity, toolRevision: v.toolRevision, sourcePlanPath: plan.host.writerPlanPath, sourcePlanSha256: plan.host.writerPlanSha256, sourcePlan, host: plan.host, modules: v.writerModules });
  const commands = [plan.host.writerFence, ...Object.values(v.writerModules), v.recoveryAudit.verifier, v.dynamic.collector, v.dynamic.verifier, migrationBinding.collector, migrationBinding.writerFence, activationBinding.activationCommand, activationBinding.recoveryCommand];
  for (const c of commands) verify(c);
  const host = { ...plan.host };
  let started = false;
  const boundMigration = { ...migrationBinding };
  try {
    const runWriter = async (c, args, input) => {
      if (c.path !== host.writerFence.path) return runFixedPython(c, args, input);
      const cb = args[3];
      if (args[0] !== "--apply-reviewed-fence" || args[1] !== host.writerPlanPath || args[2] !== host.writerPlanSha256 || !writerCallbacks.includes(cb)) throw Error("PERSISTENT_WRITER_ROUTING");
      if (!started) {
        const sealed = await lifecycle.start();
        Object.assign(host, sealed);
        Object.assign(boundMigration, { writerPlanPath: host.writerPlanPath, writerPlanSha256: host.writerPlanSha256, writerPlanCanonicalSha256: host.writerPlanCanonicalSha256 });
        started = true;
      }
      return lifecycle.invoke(cb, plan.identity);
    };
    const activation = { ...io.activation(activationBinding, void 0, (identity2, ref4) => lifecycle.recoverRetainedBaseline(identity2, ref4)), drainRuns: () => lifecycle.readRunDrain(plan.identity) };
    const manifest = io.readBytes(v.prepared.manifest.path, v.prepared.manifest.sha256);
    const inputs = {
      lane: "maintenance",
      preparedReceipt: io.readJson(v.prepared.receipt.path, v.prepared.receipt.sha256),
      preparedManifest: manifest,
      verifyOfflineArtifacts: verifyOfflineManifest(plan.identity, manifest, v.prepared.manifest.sha256, v.dockerRuntime),
      migration: migrationInputs,
      migrationTransport: io.migration(migrationInputs, boundMigration, runWriter, { migrateExactPlan: (identity2) => lifecycle.migrateExactPlan(identity2), readDiagnosticLedger: (identity2) => lifecycle.readDiagnosticLedger(identity2), recordMigrationCompletion: (identity2, stage, receipt) => lifecycle.recordMigrationCompletion(identity2, stage, receipt) }),
      activation,
      replayPreholdRecovery: preholdRecoveryArtifactAudit(v.recoveryAudit.verifier, v.toolRevision, v.recoveryAudit.evidenceSha256, runFixedPython),
      verifyCandidateAcceptance: async (identity2) => {
        if (!same4(identity2, plan.identity)) throw Error("ACCEPTANCE_IDENTITY");
        const c = await activation.verifyCanonical();
        if (c.status !== "passed" || c.lockRetained !== true || c.passedStages !== 8) throw Error("CANDIDATE_CANONICAL_REJECTED");
        const b = await activation.runBrowserSmoke();
        if (Object.values(b).length !== 6 || Object.values(b).some((v2) => v2 !== true)) throw Error("CANDIDATE_BROWSER_REJECTED");
      },
      collector: v.dynamic.collector,
      preactivateVerifier: v.dynamic.verifier,
      readValidatedReceipt: readProductionValidatedReceipt,
      runBash: runFixedBash,
      release: v.dynamic.release,
      assertProtectedInputs: async () => {
        for (const c of commands) verify(c);
      }
    };
    return { host, inputs, run: runWriter, acquireLock: async () => {
      const release = await io.acquireLock();
      return async () => {
        if (started) await lifecycle.closeAfterAccepted();
        await release();
      };
    }, retainUnknown: () => lifecycle.retainUnknown() };
  } catch (error) {
    lifecycle.retainUnknown();
    throw error;
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/typed_operations.ts
var activationMethods = ["readBaselineFingerprint", "drainRuns", "promotePreparedPointer", "activateTraffic", "verifyCanonical", "runBrowserSmoke", "restoreBaseline", "restorePointer"];
async function bindTypedProductionOperations(value) {
  if (value.admittedARoute) {
    if (typeof value.assertProtectedInputs !== "function") throw Error("A_ROUTE_SOURCE_ADMISSION_MISSING");
    for (const name of aRouteOperationNames) if (typeof value.admittedARoute[name] !== "function") throw Error("A_ROUTE_SOURCE_OPERATION_MISSING:" + name);
    await value.assertProtectedInputs();
    return { aRoute: Object.freeze({ ...value.admittedARoute }) };
  }
  if (value.aRouteInputs) return { aRoute: await bindARouteHostOperations(value.aRouteInputs) };
  const missing = [];
  for (const key of ["verifyOfflineArtifacts", "replayPreholdRecovery", "verifyCandidateAcceptance", "readValidatedReceipt", "runBash", "assertProtectedInputs"]) if (typeof value[key] !== "function") missing.push(key);
  if (!Buffer.isBuffer(value.preparedManifest) || value.preparedReceipt === void 0) missing.push("preparedArtifacts");
  if (!value.migration) missing.push("migrationInputs");
  for (const key of ["migrate", "readFreshCompletion", "verifyLiveWriterBarrier"]) if (typeof value.migrationTransport?.[key] !== "function") missing.push("migrationTransport." + key);
  for (const key of activationMethods) if (typeof value.activation?.[key] !== "function") missing.push("activation." + key);
  if (!value.collector || !value.preactivateVerifier || !value.release) missing.push("dynamicInputs");
  if (missing.length) throw new Error("PROTECTED_OPERATIONS_MISSING:" + missing.sort().join(","));
  const input = value;
  await input.assertProtectedInputs();
  const dynamic = productionDynamicActions(input.collector, input.preactivateVerifier, input.release, input.runBash, input.readValidatedReceipt);
  return {
    prepareOffline: (input.lane === "maintenance" ? maintenanceOfflinePreparedAction : offlinePreparedAction)(input.preparedReceipt, input.preparedManifest, input.verifyOfflineArtifacts),
    verifyThreeDatabaseRecovery: input.replayPreholdRecovery,
    migrateExactPlan: exactMigrationAction(input.migration, input.migrationTransport),
    ...dynamic,
    activate: (input.lane === "maintenance" ? maintenanceActivationAction : preparedActivationAction)(input.preparedReceipt, input.activation),
    verifyAcceptance: input.verifyCandidateAcceptance
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/entry.ts
function reject2(message) {
  throw new Error(message);
}
function same5(a, b) {
  return !!a && typeof a === "object" && Object.keys(a).sort().join(",") === Object.keys(b).sort().join(",") && Object.entries(b).every(([k, v]) => a[k] === v);
}
function parseEntryPlan(value) {
  if (!value || typeof value !== "object") reject2("HOST_PLAN_SCHEMA");
  const plan = value;
  if (Object.keys(plan).sort().join(",") !== ["schemaVersion", "productionActionsAuthorized", "identity", "host", "production", "recoveryPlanPath", "recoveryPlanSha256", "consumerInputsPath", "consumerInputsSha256"].sort().join(",") || plan.schemaVersion !== 1 || plan.productionActionsAuthorized !== true) reject2("HOST_PLAN_SCHEMA");
  const id3 = plan.identity;
  if (!id3 || Object.keys(id3).sort().join(",") !== "attemptId,baselineRevision,migrationPlanSha256,sourceRevision" || !/^[a-f0-9]{40}$/.test(id3.sourceRevision) || !/^[a-f0-9]{40}$/.test(id3.baselineRevision) || !/^[a-f0-9]{64}$/.test(id3.migrationPlanSha256) || !/^[A-Za-z0-9-]{1,128}$/.test(id3.attemptId)) reject2("HOST_PLAN_IDENTITY");
  if (!plan.host || !plan.production || !same5(plan.host.identity, id3) || !same5(plan.production.identity, id3)) reject2("HOST_PLAN_IDENTITY");
  if (plan.recoveryPlanPath !== `/etc/workspacex-cn/maintenance-recovery/${id3.sourceRevision}/${id3.attemptId}/recovery-plan.json` || !/^[a-f0-9]{64}$/.test(plan.recoveryPlanSha256)) reject2("HOST_PLAN_RECOVERY_BINDING");
  if (plan.production.recoveryPreflight?.planPath !== plan.recoveryPlanPath || plan.production.recoveryPreflight?.planSha256 !== plan.recoveryPlanSha256 || plan.production.recoveryPreflight?.command.path !== "/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py") reject2("HOST_PLAN_RECOVERY_BINDING");
  if (plan.consumerInputsPath !== `/etc/workspacex-cn/maintenance-host/${id3.sourceRevision}/${id3.attemptId}/consumer-inputs.json` || !/^[a-f0-9]{64}$/.test(plan.consumerInputsSha256)) reject2("HOST_CONSUMER_BINDING");
  return plan;
}
async function executeBoundEntry(plan, inputs, verifyProfile, runtime) {
  const actions = await bindTypedProductionOperations(inputs);
  const primitives = (runtime ? productionStartupPrimitives : productionPrimitives)(plan.production, runFixedPython, verifyProfile, runtime?.acquireLock ?? inheritedFd9Lock);
  Object.assign(primitives, actions);
  await runHostMaintenanceRetainingFd9({ ...plan.identity, maintenanceOptIn: "stop-all-writes-and-require-database-recovery" }, plan.host, primitives, runtime?.run ?? runFixedPython);
}
async function main2(args) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) reject2("ROOT_LINUX_REQUIRED");
  if (args.length !== 3 || args[0] !== "--run-reviewed-maintenance" || typeof args[1] !== "string" || typeof args[2] !== "string" || !/^\/etc\/workspacex-cn\//.test(args[1]) || !/^[a-f0-9]{64}$/.test(args[2])) reject2("HOST_ENTRY_USAGE");
  const plan = parseEntryPlan(protectedPrivateJson(args[1], args[2]));
  const profile = protectedPrivateJson("/etc/workspacex-cn/trusted-tool-binding.json");
  if (profile.toolRevision !== plan.production.toolRevision) reject2("HOST_PROFILE_TOOL_REVISION");
  const descriptor = profile.maintenanceHostController;
  if (!descriptor || descriptor.toolRevision !== profile.toolRevision || profile.filesSha256?.[descriptor.sourcePath] !== descriptor.sha256 || descriptor.path !== process.argv[1] || !descriptor.path.endsWith(".cjs")) reject2("HOST_ENTRY_PROFILE_BINDING");
  const fd = protectedExecutable(descriptor);
  try {
    if ((0, import_node_crypto14.createHash)("sha256").update((0, import_node_fs9.readFileSync)(fd)).digest("hex") !== descriptor.sha256) reject2("HOST_ENTRY_PROFILE_BINDING");
  } finally {
    (0, import_node_fs9.closeSync)(fd);
  }
  await inheritedFd9Lock();
  const consumers = await createProductionConsumers(plan, profile);
  try {
    await executeBoundEntry({ ...plan, host: consumers.host }, consumers.inputs, async (host, binding2) => {
      const commands = [host.hold, host.writerFence, binding2.recoveryPreflight.command];
      for (const command3 of commands) {
        const hash10 = profile.installedFilesSha256?.[command3.path];
        if (hash10 !== command3.sha256) reject2("HOST_COMMAND_PROFILE_BINDING");
        const fd2 = protectedExecutable(command3);
        (0, import_node_fs9.closeSync)(fd2);
      }
    }, { run: consumers.run, acquireLock: consumers.acquireLock });
  } catch (error) {
    consumers.retainUnknown();
    throw error;
  }
}
if (process.argv[1]?.endsWith("cn-maintenance-host-controller.cjs")) main2(process.argv.slice(2)).catch((error) => {
  const code = error instanceof Error ? error.message : "";
  process.stderr.write(code.startsWith("PROTECTED_OPERATIONS_MISSING:") && /^[A-Za-z0-9_.,:]+$/.test(code) ? code + "\n" : "MAINTENANCE_HOST_ENTRY_REJECTED\n");
  process.exitCode = 1;
});

// packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts
var PROFILE = "/etc/workspacex-cn/trusted-tool-binding.json";
function reference(value) {
  if (!value || Object.keys(value).sort().join(",") !== "path,sha256" || typeof value.path !== "string" || !value.path.startsWith("/etc/workspacex-cn/") || value.path.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(value.sha256)) throw Error("CANDIDATE_COMPOSE_AUTHORITY_REF");
  return value;
}
async function candidateComposeMain(args) {
  if (args.length !== 0 || process.platform !== "linux" || process.getuid?.() !== 0) throw Error("CANDIDATE_COMPOSE_REJECTED");
  const profileRaw = protectedPrivateBytes(PROFILE), profile = JSON.parse(profileRaw.toString("utf8"));
  const capability = profile.candidateComposeEmitter;
  if (capability?.schemaVersion !== 2) throw Error("CANDIDATE_COMPOSE_AUTHORITY_CAPABILITY");
  const entryRef = reference(capability.originalEntryPlanRef), entryRaw = protectedPrivateBytes(entryRef.path, entryRef.sha256);
  const entry = parseEntryPlan(JSON.parse(entryRaw.toString("utf8")));
  const authority = readOriginalPlanAuthority(entry.host, entry.production.toolRevision, profile);
  const optionsRef = reference(capability.optionsRef), optionsRaw = protectedPrivateBytes(optionsRef.path, optionsRef.sha256), options = JSON.parse(optionsRaw.toString("utf8"));
  const manifestRef = reference(options.manifestRef), manifestRaw = protectedPrivateBytes(manifestRef.path, manifestRef.sha256), approved = JSON.parse(manifestRaw.toString("utf8"));
  const configRef = reference(capability.configRef), configRaw = protectedPrivateBytes(configRef.path, configRef.sha256), config = JSON.parse(configRaw.toString("utf8"));
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw Error("CANDIDATE_COMPOSE_REJECTED");
    chunks.push(bytes);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (runtimeDigest(request.config) !== runtimeDigest(config) || request.options.projectName !== options.projectName || request.options.runtimeDirectory !== options.runtimeDirectory) throw Error("CANDIDATE_COMPOSE_ROOT_INPUT_DRIFT");
  const result = emitCandidateComposeSource(request, authority, approved);
  for (const [ref4, raw] of [[entryRef, entryRaw], [optionsRef, optionsRaw], [manifestRef, manifestRaw], [configRef, configRaw]]) {
    if (!protectedPrivateBytes(ref4.path, ref4.sha256).equals(raw)) throw Error("CANDIDATE_COMPOSE_AUTHORITY_DRIFT");
  }
  if (!protectedPrivateBytes(PROFILE).equals(profileRaw)) throw Error("CANDIDATE_COMPOSE_AUTHORITY_DRIFT");
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (typeof require !== "undefined" && require.main === module) {
  candidateComposeMain(process.argv.slice(2)).catch(() => {
    process.stderr.write("CANDIDATE_COMPOSE_REJECTED\n");
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  candidateComposeMain
});
