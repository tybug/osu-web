<?php

// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the GNU Affero General Public License v3.0.
// See the LICENCE file in the repository root for full licence text.

namespace App\Libraries\Markdown;

use App\Libraries\LocaleMeta;
use App\Libraries\OsuWiki;
use League\CommonMark\Block\Element as Block;
use League\CommonMark\EnvironmentInterface;
use League\CommonMark\Event\DocumentParsedEvent;
use League\CommonMark\Extension\Table as TableExtension;
use League\CommonMark\Inline\Element as Inline;

class OsuMarkdownProcessor
{
    public $firstImage;
    public $title;
    public $toc;

    private $environment;
    private $event;
    private $node;

    private $listLevel;
    private $tocSlugs;

    private $relativeUrlRoot;
    private $wikiLocale;
    private $wikiRelativePath;
    private $wikiBasePath;

    public function __construct(EnvironmentInterface $environment)
    {
        $this->environment = $environment;
    }

    public function onDocumentParsed(DocumentParsedEvent $event)
    {
        $document = $event->getDocument();
        $walker = $document->walker();

        $this->relativeUrlRoot = $this->environment->getConfig('relative_url_root');
        $generateToc = $this->environment->getConfig('generate_toc');
        $recordFirstImage = $this->environment->getConfig('record_first_image');
        $titleFromDocument = $this->environment->getConfig('title_from_document');
        $this->wikiLocale = $this->environment->getConfig('wiki_locale');

        $this->setWikiPaths();

        $this->firstImage = null;
        $this->title = null;
        $this->toc = [];
        $this->tocSlugs = [];
        $this->listLevel = 0;

        while (($this->event = $walker->next()) !== null) {
            $this->node = $this->event->getNode();

            $this->updateLocaleLink();
            $this->fixRelativeUrl();
            $this->fixWikiUrl();

            if ($recordFirstImage) {
                $this->recordFirstImage();
            }

            $this->trackListLevel();

            if ($titleFromDocument) {
                $this->setTitle();
            }

            if ($generateToc) {
                $this->loadToc();
            }

            $this->parseFigure();

            $this->proxyImage();

            // last to prevent possible conflict
            $this->addClass();
        }
    }

    public function addClass()
    {
        if ($this->event->isEntering() || isset($this->node->data['attributes']['class'])) {
            return;
        }

        $blockClass = $this->environment->getConfig('block_name');

        switch (get_class($this->node)) {
            case Block\ListBlock::class:
                $class = "{$blockClass}__list";
                break;
            case Block\ListItem::class:
                $class = "{$blockClass}__list-item";

                if ($this->listLevel > 1) {
                    $class .= " {$blockClass}__list-item--deep";
                }
                break;
            case Block\Heading::class:
                $class = "{$blockClass}__header {$blockClass}__header--".$this->node->getLevel();
                break;
            case Block\Paragraph::class:
                $class = "{$blockClass}__paragraph";
                break;
            case Inline\Image::class:
                $class = "{$blockClass}__image";
                break;
            case Inline\Link::class:
                $class = "{$blockClass}__link";
                break;
            case TableExtension\Table::class:
                $class = "{$blockClass}__table";
                break;
            case TableExtension\TableCell::class:
                $class = "{$blockClass}__table-data";
                $class .= " {$blockClass}__table-data--{$this->node->align}";

                if ($this->node->type === 'th') {
                    $class .= " {$blockClass}__table-data--header";
                }
                break;
        }

        if (isset($class)) {
            $this->node->data['attributes']['class'] = $class;
        }
    }

    public function fixRelativeUrl()
    {
        if ($this->relativeUrlRoot === null) {
            return;
        }

        if (!$this->event->isEntering() || !($this->node instanceof Inline\AbstractWebResource)) {
            return;
        }

        $src = $this->node->getUrl();

        if (preg_match(',^(#|/|https?://|mailto:),', $src) !== 1) {
            if (starts_with($src, './')) {
                $src = substr($src, 2);
            }

            $this->node->setUrl($this->environment->getConfig('relative_url_root').'/'.$src);
        }
    }

    /**
     * @param \League\CommonMark\Node\Node $node
     * @return string
     */
    public function getText($node)
    {
        $text = '';

        foreach ($node->children() as $child) {
            if ($child instanceof Inline\Image) {
                // avoid using image title as text
                continue;
            } elseif (method_exists($child, 'getContent')) {
                $text .= $child->getContent();
            } elseif (method_exists($child, 'children')) {
                $text .= $this->getText($child);
            }
        }

        return presence($text);
    }

    public function loadToc()
    {
        if (
            !$this->node instanceof Block\Heading ||
            !$this->event->isEntering() ||
            $this->title === null ||
            $this->node->getLevel() > 3
        ) {
            return;
        }

        $title = $this->getText($this->node);
        $slug = presence(mb_strtolower(str_replace(' ', '-', $title))) ?? 'page';

        if (array_key_exists($slug, $this->tocSlugs)) {
            $this->tocSlugs[$slug] += 1;

            $slug .= '.'.$this->tocSlugs[$slug];
        } else {
            $this->tocSlugs[$slug] = 0;
        }

        $this->toc[$slug] = [
            'title' => $title,
            'level' => $this->node->getLevel(),
        ];

        $this->node->data['attributes']['id'] = $slug;
    }

    public function parseFigure()
    {
        if (!$this->node instanceof Block\Paragraph || !$this->event->isEntering()) {
            return;
        }

        if (count($this->node->children()) !== 1 || !$this->node->children()[0] instanceof Inline\Image) {
            return;
        }

        $blockClass = $this->environment->getConfig('block_name');

        $image = $this->node->children()[0];
        $this->node->data['attributes']['class'] = "{$blockClass}__figure-container";
        $image->data['attributes']['class'] = "{$blockClass}__figure-image";

        if (present($image->data['title'] ?? null)) {
            $text = new Inline\Text($image->data['title']);
            $textContainer = new Inline\Emphasis();
            $textContainer->data['attributes']['class'] = "{$blockClass}__figure-caption";
            $textContainer->appendChild($text);
            $this->node->appendChild($textContainer);
        }
    }

    public function fixWikiUrl()
    {
        if (!$this->event->isEntering() || !($this->node instanceof Inline\AbstractWebResource)) {
            return;
        }

        $url = $this->node->getUrl();

        $url = preg_replace_callback(',^(?:/help)?/wiki/(?<locale>[^/?#]+)(?:/(?<path>[^?#]+))?(?<query>\?.*)?(?<hash>#.*)?$,', function ($matches) {
            $matches['path'] = $matches['path'] ?? '';
            $matches['query'] = $matches['query'] ?? '';
            $matches['hash'] = $matches['hash'] ?? '';

            if (LocaleMeta::isValid($matches['locale'])) {
                $locale = $matches['locale'];
                $path = $matches['path'];
            } else {
                $path = concat_path([$matches['locale'], $matches['path']]);
            }

            if (OsuWiki::isImage($path)) {
                return route('wiki.image', compact('path'), false);
            }

            if (!isset($locale)) {
                $locale = $this->wikiLocale ?? config('app.fallback_locale');
            }

            $url = wiki_url($path, $locale, false, false);
            if (starts_with($url, $this->wikiBasePath)) {
                $url = $this->wikiRelativePath.substr($url, strlen($this->wikiBasePath));
            }

            return "{$url}{$matches['query']}{$matches['hash']}";
        }, $url);

        $this->node->setUrl($url);
    }

    public function proxyImage()
    {
        if (!$this->node instanceof Inline\Image || !$this->event->isEntering()) {
            return;
        }

        $url = $this->node->getUrl();

        if (present($url)) {
            $this->node->setUrl(proxy_media($url));
        }
    }

    public function recordFirstImage()
    {
        if ($this->firstImage !== null || !$this->node instanceof Inline\Image || !$this->event->isEntering()) {
            return;
        }

        $this->firstImage = $this->node->getUrl();
    }

    public function setTitle()
    {
        // wait until leaving otherwise node->next will be null after detaching.
        if (!$this->node instanceof Block\Heading || $this->event->isEntering() || $this->title !== null) {
            return;
        }

        $this->title = presence($this->node->getStringContent());
    }

    public function trackListLevel()
    {
        if (!$this->node instanceof Block\ListBlock) {
            return;
        }

        if ($this->event->isEntering()) {
            $this->listLevel += 1;
        } else {
            $this->listLevel -= 1;
        }
    }

    public function updateLocaleLink()
    {
        if (!$this->node instanceof Inline\Link || !$this->event->isEntering()) {
            return;
        }

        if (preg_match('#^(\w{2}(?:-\w{2})?):(.+)$#', $this->node->getUrl(), $matches) !== 1) {
            return;
        }

        $this->node->setUrl("{$matches[2]}?locale={$matches[1]}");
    }

    private function setWikiPaths()
    {
        if ($this->relativeUrlRoot === null || $this->wikiLocale === null) {
            return;
        }

        $this->wikiBasePath = route('wiki.show', ['locale' => $this->wikiLocale], false).'/';

        if (starts_with($this->relativeUrlRoot, $this->wikiBasePath)) {
            $relativeFromBase = substr($this->relativeUrlRoot, strlen($this->wikiBasePath));
            $slashes = substr_count($relativeFromBase, '/');

            if ($slashes === 0) {
                $this->wikiRelativePath = './';
            } else {
                $this->wikiRelativePath = implode('/', array_fill(0, $slashes, '..')).'/';
            }
        }
    }
}
