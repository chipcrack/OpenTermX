package OpenSSL::safe::installdata;

use strict;
use warnings;
use Exporter;
our @ISA = qw(Exporter);
our @EXPORT = qw(
    @PREFIX
    @libdir
    @BINDIR @BINDIR_REL_PREFIX
    @LIBDIR @LIBDIR_REL_PREFIX
    @INCLUDEDIR @INCLUDEDIR_REL_PREFIX
    @APPLINKDIR @APPLINKDIR_REL_PREFIX
    @ENGINESDIR @ENGINESDIR_REL_LIBDIR
    @MODULESDIR @MODULESDIR_REL_LIBDIR
    @PKGCONFIGDIR @PKGCONFIGDIR_REL_LIBDIR
    @CMAKECONFIGDIR @CMAKECONFIGDIR_REL_LIBDIR
    $COMMENT $VERSION @LDLIBS
);

our $COMMENT                    = 'This file should be used when building against this OpenSSL build, and should never be installed';
our @PREFIX                     = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src' );
our @libdir                     = ( '' );
our @BINDIR                     = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src\apps' );
our @BINDIR_REL_PREFIX          = ( 'apps' );
our @LIBDIR                     = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src' );
our @LIBDIR_REL_PREFIX          = ( '' );
our @INCLUDEDIR                 = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src\include', 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src\include' );
our @INCLUDEDIR_REL_PREFIX      = ( 'include', './include' );
our @APPLINKDIR                 = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src\ms' );
our @APPLINKDIR_REL_PREFIX      = ( 'ms' );
our @ENGINESDIR                 = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src\engines' );
our @ENGINESDIR_REL_LIBDIR      = ( 'engines' );
our @MODULESDIR                 = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src\providers' );
our @MODULESDIR_REL_LIBDIR      = ( 'providers' );
our @PKGCONFIGDIR               = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src' );
our @PKGCONFIGDIR_REL_LIBDIR    = ( '.' );
our @CMAKECONFIGDIR             = ( 'D:\OpenTermX\src-tauri\target-sftp-check\debug\build\openssl-sys-fabb424399929299\out\openssl-build\build\src' );
our @CMAKECONFIGDIR_REL_LIBDIR  = ( '.' );
our $VERSION                    = '3.6.3';
our @LDLIBS                     =
    # Unix and Windows use space separation, VMS uses comma separation
    $^O eq 'VMS'
    ? split(/ *, */, 'ws2_32.lib gdi32.lib advapi32.lib crypt32.lib user32.lib ')
    : split(/ +/, 'ws2_32.lib gdi32.lib advapi32.lib crypt32.lib user32.lib ');

1;
