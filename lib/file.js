module.exports = File

var eos = require('end-of-stream')
var EventEmitter = require('events').EventEmitter
var FileStream = require('./file-stream')
var inherits = require('inherits')
var path = require('path')
var render = require('render-media')
var stream = require('readable-stream')
var streamToBlob = require('stream-to-blob')
var streamToBlobURL = require('stream-to-blob-url')
var streamToBuffer = require('stream-with-known-length-to-buffer')

inherits(File, EventEmitter)

function File (torrent, file) {
  EventEmitter.call(this)

  this._torrent = torrent
  this._destroyed = false

  this.name = file.name
  this.path = file.path
  this.length = file.length
  this.offset = file.offset
  this.selected = file.selected

  this.done = false

  var start = file.offset
  var end = start + file.length - 1

  this._startPiece = Math.floor(start / this._torrent.pieceLength) | 0
  this._endPiece = Math.ceil(end / this._torrent.pieceLength) | 0
  if (!this._torrent.pieces[this._endPiece]) this._endPiece -= 1
  if (this.length === 0) {
    this.done = true
    this.emit('done')
  }
}

Object.defineProperty(File.prototype, 'downloaded', {
  get: function () {
    if (!this._torrent.bitfield) return 0
    var downloaded = 0
    for (var index = this._startPiece; index <= this._endPiece; ++index) {
      if (this._torrent.bitfield.get(index)) {
        // verified data
        downloaded += this._torrent.pieceLength
      } else {
        // "in progress" data
        var piece = this._torrent.pieces[index]
        downloaded += (piece.length - piece.missing)
      }
    }
    return downloaded
  }
})

File.prototype.select = function (priority) {
  if (this.length === 0) return
  this._torrent.select(this._startPiece, this._endPiece, priority)
}

File.prototype.deselect = function () {
  if (this.length === 0) return
  this._torrent.deselect(this._startPiece, this._endPiece, false)
}

File.prototype.createReadStream = function (opts) {
  var self = this
  if (this.length === 0) {
    var empty = new stream.PassThrough()
    process.nextTick(function () {
      empty.end()
    })
    return empty
  }

  var fileStream = new FileStream(self, opts)
  self._torrent.select(fileStream._startPiece, fileStream._endPiece, true, function () {
    fileStream._notify()
  })
  eos(fileStream, function () {
    if (self._destroyed) return
    if (!self._torrent.destroyed) {
      self._torrent.deselect(fileStream._startPiece, fileStream._endPiece, true)
    }
  })
  return fileStream
}

File.prototype.getBuffer = function (cb) {
  streamToBuffer(this.createReadStream(), this.length, cb)
}

File.prototype.getBlob = function (cb) {
  if (typeof window === 'undefined') throw new Error('browser-only method')
  streamToBlob(this.createReadStream(), this._getMimeType(), cb)
}

File.prototype.getBlobURL = function (cb) {
  if (typeof window === 'undefined') throw new Error('browser-only method')
  streamToBlobURL(this.createReadStream(), this._getMimeType(), cb)
}

File.prototype.appendTo = function (elem, opts, cb) {
  if (typeof window === 'undefined') throw new Error('browser-only method')
  render.append(this, elem, opts, cb)
}

File.prototype.renderTo = function (elem, opts, cb) {
  if (typeof window === 'undefined') throw new Error('browser-only method')
  render.render(this, elem, opts, cb)
}

File.prototype._getMimeType = function () {
  return render.mime[path.extname(this.name).toLowerCase()]
}

File.prototype._destroy = function () {
  this._destroyed = true
  this._torrent = null
}
