// Tests never read the developer's gh sign-in or call GitHub with it. A test that needs gh injects a fake. @req FR:pr-page/auth.token
process.env.STACK_GH_AUTH ??= 'off';
