'use strict';

// vendor/fontkit.umd.min.js（@pdf-lib/fontkit 1.1.1 の dist/fontkit.umd.min.js。書き込みの日本語の書体を PDF に埋め込む部品）に、
// 作ったときに取り込まれた部品の告知の材料（PR-6b の点検。docs/06 4-1・docs/07 決定82）。scripts/notices.js が読む。
//
// 縮めたファイルでは著作権の見出しが消えていて、取り込まれた部品は node_modules にも無い。そこで 2026-10-21 に、次の公開のページを読んで書き写した。
//   - 作ったときの設定: https://github.com/Hopding/fontkit の rollup.config.js（UMD は pako も含めて全部を 1 本に取り込み、Node の部品の代わり
//     〔rollup-plugin-node-builtins〕と Buffer の代わり〔buffer〕を入れる）と yarn.lock（版。どちらも master。1.1.1 の印は置き場所に無い）
//   - 各部品の package.json と LICENSE: https://unpkg.com/<名前>@<版>/
//   - 縮める前の node_modules/@pdf-lib/fontkit/dist/fontkit.umd.js に残っている見出し（Node.js〔Joyent〕と Google の brotli）
// 載せたのは、yarn.lock の中で、取り込まれる部品から辿れるものの全部（縮めたファイルに入っていないものを含むことがある。載せすぎは害が無い）。
// copyright は各 LICENSE の著作権の行をそのまま写した。LICENSE のファイルが無いものは package.json の作者の欄を書いた。

// LICENSE が MIT の部品。許諾文は下の MIT_TEXT で共通（各 LICENSE の本文と同じ）。
const MIT_PACKAGES = [
  { name: 'fontkit（元の作り。@pdf-lib/fontkit はこれを写したもの）', version: '1.8 系', copyright: 'LICENSE のファイルは無い。package.json の作者: Devon Govett <devongovett@gmail.com>' },
  { name: '@pdf-lib/brotli', version: '0.0.0', copyright: 'LICENSE のファイルは無い。package.json の作者: Andrew Dillon <andrew.dillon.j@gmail.com>（中の展開のコードは Google の Apache-2.0。下に掲げる）' },
  { name: '@pdf-lib/restructure', version: '0.0.1', copyright: 'LICENSE のファイルは無い。package.json の作者: Andrew Dillon <andrew.dillon.j@gmail.com>（元の restructure の作者は Devon Govett）' },
  { name: '@pdf-lib/unicode-properties', version: '0.0.1', copyright: 'Copyright 2018' },
  { name: 'base64-arraybuffer', version: '0.1.5', copyright: 'Copyright (c) 2012 Niklas von Hertzen' },
  { name: 'base64-js', version: '1.3.1（1.3.0 も）', copyright: 'Copyright (c) 2014 Jameson Little' },
  { name: 'buffer', version: '5.6.0', copyright: 'Copyright (c) Feross Aboukhadijeh, and other contributors.' },
  { name: 'clone', version: '1.0.4', copyright: 'Copyright © 2011-2015 Paul Vorbach <paul@vorba.ch>' },
  { name: 'deep-equal', version: '1.1.1', copyright: 'Copyright (c) 2012, 2013, 2014 James Halliday <mail@substack.net>, 2009 Thomas Robinson <280north.com>' },
  { name: 'define-properties', version: '1.1.3', copyright: 'Copyright (C) 2015 Jordan Harband' },
  { name: 'dfa', version: '1.2.0', copyright: 'LICENSE のファイルは無い。package.json の作者: Devon Govett <devongovett@gmail.com>' },
  { name: 'es-abstract', version: '1.17.5', copyright: 'Copyright (C) 2015 Jordan Harband' },
  { name: 'es-to-primitive', version: '1.2.1', copyright: 'Copyright (c) 2015 Jordan Harband' },
  { name: 'function-bind', version: '1.1.1', copyright: 'Copyright (c) 2013 Raynos.' },
  { name: 'has', version: '1.0.3', copyright: 'Copyright (c) 2013 Thiago de Arruda' },
  { name: 'has-symbols', version: '1.0.1', copyright: 'Copyright (c) 2016 Jordan Harband' },
  { name: 'iconv-lite', version: '0.4.24', copyright: 'Copyright (c) 2011 Alexander Shtuchkin' },
  { name: 'is-arguments', version: '1.0.4', copyright: 'Copyright (c) 2014 Jordan Harband' },
  { name: 'is-callable', version: '1.1.5', copyright: 'Copyright (c) 2015 Jordan Harband' },
  { name: 'is-date-object', version: '1.0.2', copyright: 'Copyright (c) 2015 Jordan Harband' },
  { name: 'is-regex', version: '1.0.5', copyright: 'Copyright (c) 2014 Jordan Harband' },
  { name: 'is-symbol', version: '1.0.3', copyright: 'Copyright (c) 2015 Jordan Harband' },
  { name: 'object-inspect', version: '1.7.0', copyright: 'Copyright (c) 2013 James Halliday' },
  { name: 'object-is', version: '1.1.2', copyright: 'Copyright (c) 2014 Jordan Harband' },
  { name: 'object-keys', version: '1.1.1', copyright: 'Copyright (C) 2013 Jordan Harband' },
  { name: 'object.assign', version: '4.1.0', copyright: 'Copyright (c) 2014 Jordan Harband' },
  { name: 'pako', version: '0.2.9（1.0.11 は上の節）', copyright: 'Copyright (C) 2014-2016 by Vitaly Puzrin' },
  { name: 'regexp.prototype.flags', version: '1.3.0', copyright: 'Copyright (C) 2014 Jordan Harband' },
  { name: 'safer-buffer', version: '2.1.2', copyright: 'Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com>' },
  { name: 'string.prototype.trimend', version: '1.0.1', copyright: 'Copyright (c) 2017 Khaled Al-Ansari' },
  { name: 'string.prototype.trimleft', version: '2.1.2', copyright: 'Copyright (c) 2015 Jordan Harband' },
  { name: 'string.prototype.trimright', version: '2.1.2', copyright: 'Copyright (c) 2015 Jordan Harband' },
  { name: 'string.prototype.trimstart', version: '1.0.1', copyright: 'Copyright (c) 2017 Khaled Al-Ansari' },
  { name: 'tiny-inflate', version: '1.0.3（1.0.2 も）', copyright: 'Copyright (c) 2015-present Devon Govett' },
  { name: 'unicode-trie', version: '0.3.1', copyright: 'LICENSE のファイルは無い。package.json の作者: Devon Govett <devongovett@gmail.com>' },
];

// MIT の部品の許諾文（tiny-inflate 1.0.3 の LICENSE の本文。著作権の行は上の表）。
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// MIT 以外の部品。text は LICENSE（か、縮める前のファイルに残っていた見出し）をそのまま写した全文。
const OTHER_PARTS = [
  {
    name: 'inherits 2.0.4（2.0.3 も）',
    license: 'ISC',
    text: `The ISC License

Copyright (c) Isaac Z. Schlueter

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
  },
  {
    name: 'ieee754 1.1.13',
    license: 'BSD-3-Clause',
    text: `Copyright 2008 Fair Oaks Labs, Inc.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  },
  {
    name: 'rollup-plugin-node-builtins 2.1.2（Node の部品の代わり。string_decoder など）',
    license: 'ISC（package.json の license。LICENSE のファイルは無い）。中の string_decoder は Node.js（Joyent）の MIT',
    text: `Copyright Joyent, Inc. and other Node contributors.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  },
  {
    name: 'brotli の展開（@pdf-lib/brotli の中。Google）',
    license: 'Apache-2.0（全文は、この告知の pdfjs-dist の節にある）',
    text: `Copyright 2013 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,
  },
];

module.exports = { MIT_PACKAGES, MIT_TEXT, OTHER_PARTS };
