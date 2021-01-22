"use strict";

var _Bot = _interopRequireDefault(require("./Bot"));

var _Logger = _interopRequireDefault(require("./Logger"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

var PRODUCTION_TOKEN = '';
var DEV_TOKEN = '';
var mode = process.env.NODE_ENV;
new _Bot["default"](mode === 'development' ? DEV_TOKEN : PRODUCTION_TOKEN);
process.on('unhandledRejection', function (reason, promise) {
  _Logger["default"].error('Unhandled promise rejection ' + reason.toString());

  console.log(reason);
});