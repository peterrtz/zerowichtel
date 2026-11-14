<?php
declare(strict_types=1);

// Nur für die Gegenprobe der API-Testsuite gegen die PHP-Version (1.2.1):
//   php -S 127.0.0.1:PORT tests/api/php-router.php   (mit ZW_CONFIG und ZW_PHP_ROOT)
// Wie public/api.php, aber die Uhrzeit kommt aus dem Header X-ZW-Test-Now.
require getenv('ZW_PHP_ROOT') . '/src/bootstrap.php';

use ZeroWichtel\App;
use ZeroWichtel\Db;
use ZeroWichtel\HttpError;
use ZeroWichtel\Mail\MailerFactory;
use ZeroWichtel\Request;

$now = isset($_SERVER['HTTP_X_ZW_TEST_NOW']) ? (int) $_SERVER['HTTP_X_ZW_TEST_NOW'] : time();
try {
    $config = zw_config();
    $request = Request::fromGlobals($config);
    $app = new App(Db::open($config['db_path']), $config, fn (): int => $now, MailerFactory::fromConfig($config));
    $response = $app->handle($request);
} catch (HttpError $e) {
    $response = $e->toResponse();
}
$response->send();
